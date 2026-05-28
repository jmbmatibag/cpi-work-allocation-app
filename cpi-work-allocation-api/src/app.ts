import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import { prisma } from './lib/prisma.js';
import { errorHandler } from './middleware/errorHandler.js';
import authRouter from './routes/auth.js';
import settingsRouter from './routes/settings.js';
import employeesRouter from './routes/employees.js';
import allocationsRouter from './routes/allocations.js';
import journalRouter from './routes/journal.js';
import migrateRouter from './routes/migrate.js';

export function createApp() {
  const app = express();

  // Required behind Nginx for req.ip + express-rate-limit + secure cookies.
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(
    cors({
      origin: (process.env.CORS_ORIGIN ?? 'http://localhost:8080')
        .split(',')
        .map((s) => s.trim()),
      credentials: true,
    })
  );
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());

  // Skip noisy HTTP logs in test mode.
  if (process.env.NODE_ENV !== 'test') {
    app.use(pinoHttp());
  }

  app.get('/api/health', async (_req, res, next) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ok', time: new Date().toISOString() });
    } catch (err) {
      next(err);
    }
  });

  app.use('/api/auth', authRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/employees', employeesRouter);
  app.use('/api/allocations', allocationsRouter);
  app.use('/api/journal', journalRouter);
  app.use('/api/migrate', migrateRouter);

  app.use(errorHandler);

  return app;
}
