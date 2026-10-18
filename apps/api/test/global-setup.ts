import { MongoMemoryReplSet } from 'mongodb-memory-server';

/**
 * Starts one in-memory replica set for the whole integration run. Each test file uses its own
 * database name (see test-app.ts) so files are isolated and can never touch a real database.
 */
export default async function globalSetup(): Promise<void> {
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  process.env.__MONGO_TEST_URI__ = replSet.getUri();
  // Stash on global so teardown can stop it.
  (globalThis as unknown as { __MONGO_REPLSET__: MongoMemoryReplSet }).__MONGO_REPLSET__ = replSet;
}
