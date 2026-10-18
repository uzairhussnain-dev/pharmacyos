import { plainToInstance, Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Min, MinLength, validateSync } from 'class-validator';

export class EnvConfig {
  @IsOptional()
  @IsString()
  MONGODB_URI?: string;

  @IsString()
  @MinLength(32, { message: 'JWT_ACCESS_SECRET must be at least 32 characters' })
  JWT_ACCESS_SECRET: string;

  @IsString()
  @MinLength(32, { message: 'JWT_REFRESH_SECRET must be at least 32 characters' })
  JWT_REFRESH_SECRET: string;

  @Transform(({ value }) => Number(value ?? 900))
  @IsInt()
  @Min(60)
  JWT_ACCESS_TTL = 900;

  @Transform(({ value }) => Number(value ?? 604800))
  @IsInt()
  @Min(300)
  JWT_REFRESH_TTL = 604800;

  @Transform(({ value }) => Number(value ?? 4000))
  @IsInt()
  API_PORT = 4000;

  @IsString()
  CORS_ORIGINS = 'http://localhost:3000';

  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  COOKIE_SECURE = false;

  @IsString()
  LOG_LEVEL = 'info';

  @IsOptional()
  @IsString()
  OPENAI_API_KEY?: string;

  @IsOptional()
  @IsString()
  OPENAI_MODEL?: string;

  @IsOptional()
  @IsString()
  REDIS_URL?: string;

  @IsString()
  NODE_ENV = 'development';
}

export function validateEnv(raw: Record<string, unknown>): EnvConfig {
  const config = plainToInstance(EnvConfig, raw, { enableImplicitConversion: false });
  const errors = validateSync(config, { skipMissingProperties: false, whitelist: true });
  if (errors.length) {
    const messages = errors.flatMap((e) => Object.values(e.constraints ?? {}));
    throw new Error(`Invalid environment configuration:\n - ${messages.join('\n - ')}`);
  }
  return config;
}
