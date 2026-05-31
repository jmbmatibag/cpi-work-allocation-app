import { PrismaClient } from '../generated/prisma/client.js';

// Single-box t3a.small (2 vCPU, 2 GB RAM shared with Postgres): cap the
// connection pool so Prisma never exhausts Postgres's max_connections budget.
// PM2 runs one worker, so total connections = 1 × DB_POOL_LIMIT = 3.
// Overridable via .env (DB_POOL_LIMIT, DB_POOL_TIMEOUT).
function buildDatasourceUrl(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL is not set');
  const url = new URL(raw);
  if (!url.searchParams.has('connection_limit')) {
    url.searchParams.set('connection_limit', process.env.DB_POOL_LIMIT ?? '3');
  }
  if (!url.searchParams.has('pool_timeout')) {
    url.searchParams.set('pool_timeout', process.env.DB_POOL_TIMEOUT ?? '10');
  }
  return url.toString();
}

export const prisma = new PrismaClient({
  datasourceUrl: buildDatasourceUrl(),
});
