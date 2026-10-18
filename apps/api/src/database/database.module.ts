import { Global, Injectable, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, MongooseModule } from '@nestjs/mongoose';
import mongoose, { ClientSession, Connection } from 'mongoose';
import { EnvConfig } from '../config/env.config';

/**
 * Resolves the MongoDB URI. When MONGODB_URI is empty, boots an embedded single-node replica set
 * (mongodb-memory-server binary) that PERSISTS to <repo>/.mongo-data on a fixed port, so local
 * development needs zero database setup while still supporting transactions. Not for production.
 */
export async function resolveMongoUri(config: ConfigService<EnvConfig, true>): Promise<string> {
  const explicit = config.get('MONGODB_URI', { infer: true });
  if (explicit) return explicit;
  if (config.get('NODE_ENV', { infer: true }) === 'production') {
    throw new Error('MONGODB_URI is required in production');
  }
  const { MongoMemoryReplSet } = await import('mongodb-memory-server');
  const path = await import('node:path');
  const fs = await import('node:fs');
  const dbPath = path.resolve(process.cwd(), process.env.EMBEDDED_MONGO_PATH ?? '../../.mongo-data');
  fs.mkdirSync(dbPath, { recursive: true });
  const port = Number(process.env.EMBEDDED_MONGO_PORT ?? 27117);
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, name: 'rs0', storageEngine: 'wiredTiger' },
    instanceOpts: [{ port, dbPath, storageEngine: 'wiredTiger' }],
  });
  embedded = replSet;
  const uri = replSet.getUri('pharmacyos');
  Logger.warn(`MONGODB_URI not set — using embedded replica set at ${uri} (data dir: ${dbPath}).`, 'Database');
  return uri;
}
let embedded: { stop(): Promise<boolean> } | undefined;

@Injectable()
export class TransactionService implements OnApplicationShutdown {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  /**
   * Runs `fn` inside a MongoDB transaction with the driver's built-in retry for transient errors.
   * Any thrown error aborts the transaction and is re-thrown.
   */
  async withTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = await this.connection.startSession();
    try {
      let result!: T;
      await session.withTransaction(
        async () => {
          result = await fn(session);
        },
        { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' },
      );
      return result;
    } finally {
      await session.endSession();
    }
  }

  get conn(): Connection {
    return this.connection;
  }

  async onApplicationShutdown(): Promise<void> {
    if (embedded) {
      await mongoose.disconnect().catch(() => undefined);
      await embedded.stop();
      embedded = undefined;
    }
  }
}

@Global()
@Module({
  imports: [
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: async (config: ConfigService<EnvConfig, true>) => ({
        uri: await resolveMongoUri(config),
        autoIndex: true,
        serverSelectionTimeoutMS: 10_000,
      }),
    }),
  ],
  providers: [TransactionService],
  exports: [TransactionService, MongooseModule],
})
export class DatabaseModule {}
