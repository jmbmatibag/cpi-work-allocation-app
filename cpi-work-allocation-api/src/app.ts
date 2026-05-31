import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import rateLimit from 'express-rate-limit';
import { prisma } from './lib/prisma.js';
import { errorHandler } from './middleware/errorHandler.js';
import authRouter from './routes/auth.js';
import settingsRouter from './routes/settings.js';
import employeesRouter from './routes/employees.js';
import allocationsRouter from './routes/allocations.js';
import journalRouter from './routes/journal.js';
import migrateRouter from './routes/migrate.js';

// Global guard: 120 requests/min per IP across all API routes.
// Auth routes layer their own tighter per-endpoint limits on top of this.
// On a single-box EC2 this prevents a rogue client from spiking the CPU
// before the per-route limiters even fire.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down.' },
});

export function createApp() {
  const app = express();

  // Required behind Nginx for req.ip + express-rate-limit + secure cookies.
  app.set('trust proxy', 1);

  app.use(
    helmet({
      // HSTS: 2-year max-age, preload-eligible. Nginx adds this on 443 too,
      // but setting it in the app ensures it survives a mis-configured proxy.
      hsts: {
        maxAge: 63072000,
        includeSubDomains: true,
        preload: true,
      },
      // COEP is irrelevant for a JSON API — disabling avoids breaking
      // cross-origin fetch from the Nginx-served SPA.
      crossOriginEmbedderPolicy: false,
    })
  );
  app.use(
    cors({
      origin: (process.env.CORS_ORIGIN ?? 'http://localhost:8080')
        .split(',')
        .map((s) => s.trim()),
      credentials: true,
    })
  );
  // Global rate limit applied before route handlers so it covers every
  // endpoint — including any future routes added without their own limiter.
  app.use('/api', apiLimiter);
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
