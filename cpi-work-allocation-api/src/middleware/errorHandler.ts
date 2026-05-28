import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '../generated/prisma/client.js';

// Global error handler. Express 5 forwards async-handler rejections here
// automatically, so route handlers do not need try/catch wrappers. The
// goal is two-fold: map known errors (Zod, Prisma) to clean 4xx JSON, and
// guarantee no stack trace ever leaves the server.
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (res.headersSent) {
    // If a handler already started writing, we can only break the connection.
    return;
  }

  if (err instanceof ZodError) {
    // Strip `received` and any other input echoes — return only the
    // shape (path + code + message). Avoids reflecting potentially
    // sensitive submitted values back to the client.
    const issues = err.issues.map((i) => ({
      path: i.path,
      code: i.code,
      message: i.message,
    }));
    res.status(400).json({ error: 'Validation error', issues });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      res.status(409).json({ error: 'UNIQUE_CONSTRAINT', target: err.meta?.target });
      return;
    }
    if (err.code === 'P2025') {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }
    if (err.code === 'P2003') {
      res.status(409).json({ error: 'FK_CONSTRAINT', target: err.meta?.field_name });
      return;
    }
  }

  if (err instanceof Prisma.PrismaClientValidationError) {
    res.status(400).json({ error: 'Invalid query parameters' });
    return;
  }

  // Unknown error: log full stack server-side, send opaque 500 to client.
  const logger = (req as { log?: { error: (e: unknown, msg?: string) => void } }).log;
  if (logger) logger.error(err, 'Unhandled error');
  else console.error('Unhandled error', err);
  res.status(500).json({ error: 'Internal server error' });
};
