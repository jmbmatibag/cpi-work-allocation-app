import 'dotenv/config';

// Suppress pino-http logs during tests
process.env.NODE_ENV = 'test';

// Provide required env vars for the app factory (JWT_SECRET, CORS_ORIGIN).
// DATABASE_URL comes from .env — tests use the dev DB in a dedicated schema.
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'test_secret_at_least_32_chars_long_for_vitest';
}
if (!process.env.CORS_ORIGIN) {
  process.env.CORS_ORIGIN = 'http://localhost:8080';
}
