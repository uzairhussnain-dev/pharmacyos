// Runs before any test module is imported, so ConfigModule validation sees test values.
process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-test-access-secret-0123456789';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-test-refresh-secret-0123456789';
process.env.LOG_LEVEL = 'silent';
process.env.CORS_ORIGINS = 'http://localhost:3000';
process.env.COOKIE_SECURE = 'false';
// Point at the shared test replica set (per-file DB is chosen in createTestApp).
if (process.env.__MONGO_TEST_URI__) process.env.MONGODB_URI = process.env.__MONGO_TEST_URI__;
if (typeof jest !== 'undefined') {
  jest.setTimeout(120_000);
}

