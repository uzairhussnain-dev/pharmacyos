import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { RolePermissions } from '@pharmacy-os/shared-types';
import * as bcrypt from 'bcryptjs';
import { Model } from 'mongoose';
import { EnvConfig } from '../../config/env.config';
import { User, UserDocument } from '../../database/schemas/user.schema';
import { AppException, ErrorCodes } from '../../common/errors';
import { HttpStatus } from '@nestjs/common';
import { AuditService } from '../audit/audit.module';
import { AuthUser } from '../../common/decorators';

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

export interface AccessPayload {
  sub: string;
  username: string;
  role: string;
  tv: number;
  typ: 'access';
}
export interface RefreshPayload {
  sub: string;
  tv: number;
  typ: 'refresh';
}

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<EnvConfig, true>,
    private readonly audit: AuditService,
  ) {}

  async validateCredentials(username: string, password: string, meta: { ip?: string; requestId?: string }) {
    const user = await this.users.findOne({ username: username.toLowerCase().trim() }).select('+passwordHash');
    // Constant-time-ish: always run a bcrypt compare even when user is missing.
    const hash = user?.passwordHash ?? '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalid';
    const ok = await bcrypt.compare(password, hash);

    if (!user || !ok) {
      if (user) {
        const attempts = user.failedLoginAttempts + 1;
        const update: Partial<User> = { failedLoginAttempts: attempts };
        if (attempts >= MAX_FAILED_ATTEMPTS) {
          update.lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60_000);
          update.failedLoginAttempts = 0;
        }
        await this.users.updateOne({ _id: user._id }, { $set: update });
      }
      await this.audit.record({
        action: 'auth.login.failed',
        entityType: 'User',
        entityId: user?._id,
        after: { username: username.toLowerCase() },
        ip: meta.ip,
        requestId: meta.requestId,
      });
      throw new AppException(ErrorCodes.INVALID_CREDENTIALS, 'Invalid username or password', HttpStatus.UNAUTHORIZED);
    }
    if (!user.isActive) {
      throw new AppException(ErrorCodes.ACCOUNT_DISABLED, 'This account has been disabled', HttpStatus.FORBIDDEN);
    }
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw new AppException(
        ErrorCodes.RATE_LIMITED,
        `Account temporarily locked. Try again after ${user.lockedUntil.toISOString()}`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    await this.users.updateOne(
      { _id: user._id },
      { $set: { failedLoginAttempts: 0, lastLoginAt: new Date() }, $unset: { lockedUntil: 1 } },
    );
    await this.audit.record({
      actorId: user._id,
      actorName: user.name,
      action: 'auth.login',
      entityType: 'User',
      entityId: user._id,
      ip: meta.ip,
      requestId: meta.requestId,
    });
    return user;
  }

  toAuthUser(user: UserDocument): AuthUser {
    return {
      id: user._id.toString(),
      username: user.username,
      name: user.name,
      role: user.role,
      permissions: RolePermissions[user.role],
      tokenVersion: user.tokenVersion,
    };
  }

  issueAccessToken(user: UserDocument): { token: string; expiresIn: number } {
    const expiresIn = this.config.get('JWT_ACCESS_TTL', { infer: true });
    const payload: AccessPayload = {
      sub: user._id.toString(),
      username: user.username,
      role: user.role,
      tv: user.tokenVersion,
      typ: 'access',
    };
    return {
      token: this.jwt.sign(payload, { secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }), expiresIn }),
      expiresIn,
    };
  }

  issueRefreshToken(user: UserDocument): string {
    const payload: RefreshPayload = { sub: user._id.toString(), tv: user.tokenVersion, typ: 'refresh' };
    return this.jwt.sign(payload, {
      secret: this.config.get('JWT_REFRESH_SECRET', { infer: true }),
      expiresIn: this.config.get('JWT_REFRESH_TTL', { infer: true }),
    });
  }

  async verifyRefreshToken(token: string): Promise<UserDocument> {
    let payload: RefreshPayload;
    try {
      payload = this.jwt.verify<RefreshPayload>(token, { secret: this.config.get('JWT_REFRESH_SECRET', { infer: true }) });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    if (payload.typ !== 'refresh') throw new UnauthorizedException('Invalid token type');
    const user = await this.users.findById(payload.sub);
    if (!user || !user.isActive || user.tokenVersion !== payload.tv) {
      throw new UnauthorizedException('Session is no longer valid');
    }
    return user;
  }

  /** Invalidate all refresh tokens for a user (logout everywhere). */
  async revokeAll(userId: string): Promise<void> {
    await this.users.updateOne({ _id: userId }, { $inc: { tokenVersion: 1 } });
  }

  async findById(id: string): Promise<UserDocument | null> {
    return this.users.findById(id);
  }

  static async hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, 12);
  }
}
