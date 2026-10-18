import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { EnvConfig } from '../../config/env.config';
import { AccessPayload, AuthService } from './auth.service';
import { AuthUser } from '../../common/decorators';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService<EnvConfig, true>,
    private readonly auth: AuthService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_ACCESS_SECRET', { infer: true }),
    });
  }

  async validate(payload: AccessPayload): Promise<AuthUser> {
    if (payload.typ !== 'access') throw new UnauthorizedException();
    const user = await this.auth.findById(payload.sub);
    if (!user || !user.isActive) throw new UnauthorizedException('Account is disabled');
    // Reject access tokens issued before a global revoke (password change / logout-all).
    if (user.tokenVersion !== payload.tv) throw new UnauthorizedException('Session expired');
    return this.auth.toAuthUser(user);
  }
}
