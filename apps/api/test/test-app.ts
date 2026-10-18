import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { User, UserDocument } from '../src/database/schemas/user.schema';
import { AuthService } from '../src/modules/auth/auth.service';
import type { Role } from '@pharmacy-os/shared-types';

export interface TestContext {
  app: INestApplication;
  http: () => request.Agent;
  login: (username: string, password?: string) => Promise<string>;
  createUser: (username: string, role: Role, password?: string) => Promise<string>;
  auth: (token: string) => { Authorization: string };
  close: () => Promise<void>;
}

const DEFAULT_PASSWORD = 'Passw0rd!test';

/**
 * Boots the full Nest application against an isolated database on the shared test replica set.
 * Never points at MONGODB_URI from the environment — guaranteed isolation from any real data.
 */
export async function createTestApp(dbName: string): Promise<TestContext> {
  const base = process.env.__MONGO_TEST_URI__;
  if (!base) throw new Error('Test replica set not started (globalSetup missing)');
  const uri = base.replace(/\/\?/, `/${dbName}?`);
  process.env.MONGODB_URI = uri;
  process.env.JWT_ACCESS_SECRET = 'test-access-secret-test-access-secret-0123456789';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-test-refresh-secret-0123456789';
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'silent';
  process.env.CORS_ORIGINS = 'http://localhost:3000';

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app);
  await app.init();

  const users = app.get<Model<UserDocument>>(getModelToken(User.name));

  const createUser = async (username: string, role: Role, password = DEFAULT_PASSWORD) => {
    const u = await users.create({ name: username, username, passwordHash: await AuthService.hashPassword(password), role, isActive: true });
    return u._id.toString();
  };
  const login = async (username: string, password = DEFAULT_PASSWORD) => {
    const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ username, password });
    if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.accessToken as string;
  };

  return {
    app,
    http: () => request(app.getHttpServer()),
    login,
    createUser,
    auth: (token) => ({ Authorization: `Bearer ${token}` }),
    close: async () => {
      await app.close();
    },
  };
}

export const futureDate = (days: number) => new Date(Date.now() + days * 86400_000).toISOString().slice(0, 10);
