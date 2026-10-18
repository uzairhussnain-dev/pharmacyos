import { Body, Controller, Get, HttpCode, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsString, MaxLength, MinLength } from 'class-validator';
import type { Request, Response } from 'express';
import { EnvConfig } from '../../config/env.config';
import { AuthUser, CurrentUser, Public, RequestId } from '../../common/decorators';
import { AuthService } from './auth.service';

export class LoginDto {
  @IsString()
  @MinLength(3)
  @MaxLength(64)
  username: string;

  @IsString()
  @MinLength(6)
  @MaxLength(128)
  password: string;
}

const REFRESH_COOKIE = 'pos_refresh';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<EnvConfig, true>,
  ) {}

  private cookieOptions() {
    return {
      httpOnly: true,
      secure: this.config.get('COOKIE_SECURE', { infer: true }),
      sameSite: 'strict' as const,
      path: '/api/v1/auth',
      maxAge: this.config.get('JWT_REFRESH_TTL', { infer: true }) * 1000,
    };
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Login with username/password. Returns access token; sets httpOnly refresh cookie.' })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @RequestId() requestId: string,
  ) {
    const user = await this.auth.validateCredentials(dto.username, dto.password, { ip: req.ip, requestId });
    const access = this.auth.issueAccessToken(user);
    res.cookie(REFRESH_COOKIE, this.auth.issueRefreshToken(user), this.cookieOptions());
    return { accessToken: access.token, expiresIn: access.expiresIn, user: this.auth.toAuthUser(user) };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Exchange refresh cookie for a new access token (rotates the refresh cookie).' })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    // CSRF defence-in-depth: cookie is SameSite=Strict AND we require a custom header that
    // cross-origin forms cannot set.
    if (req.headers['x-requested-with'] !== 'PharmacyOS') {
      throw new UnauthorizedException('Missing CSRF header');
    }
    const token = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    if (!token) throw new UnauthorizedException('No refresh token');
    const user = await this.auth.verifyRefreshToken(token);
    const access = this.auth.issueAccessToken(user);
    res.cookie(REFRESH_COOKIE, this.auth.issueRefreshToken(user), this.cookieOptions());
    return { accessToken: access.token, expiresIn: access.expiresIn, user: this.auth.toAuthUser(user) };
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    if (token) {
      try {
        const user = await this.auth.verifyRefreshToken(token);
        await this.auth.revokeAll(user._id.toString());
      } catch {
        // Already invalid — nothing to revoke.
      }
    }
    res.clearCookie(REFRESH_COOKIE, { ...this.cookieOptions(), maxAge: 0 });
  }

  @Get('me')
  @ApiBearerAuth()
  me(@CurrentUser() user: AuthUser) {
    return user;
  }
}
