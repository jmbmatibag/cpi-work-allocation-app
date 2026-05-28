import type { Request, RequestHandler } from 'express';
import type { ZodType, infer as ZodInfer } from 'zod';

export type ValidationSource = 'body' | 'query' | 'params';

// Express 5 makes req.query and req.params getter-only — reassigning them
// throws. So instead of overwriting, the middleware stashes parsed data on
// req.valid[source] and handlers read it via getValid().
type ValidContainer = {
  body?: unknown;
  query?: unknown;
  params?: unknown;
};

function pick(req: Request, source: ValidationSource): unknown {
  if (source === 'body') return req.body;
  if (source === 'query') return req.query;
  return req.params;
}

export function validate<S extends ZodType>(
  schema: S,
  source: ValidationSource = 'body'
): RequestHandler {
  return (req, res, next) => {
    const parsed = schema.safeParse(pick(req, source));
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => ({
        path: i.path,
        code: i.code,
        message: i.message,
      }));
      res.status(400).json({ error: 'Validation error', issues });
      return;
    }
    const reqWithValid = req as Request & { valid?: ValidContainer };
    if (!reqWithValid.valid) reqWithValid.valid = {};
    reqWithValid.valid[source] = parsed.data;
    next();
  };
}

// Type-safe reader for handlers. Re-passing the schema is what gives us
// z.infer<typeof Schema> without per-route generics or module augmentation.
// Throws (caught by the global error handler) if the matching validate()
// middleware wasn't mounted — fails loud rather than returning undefined.
export function getValid<S extends ZodType>(
  req: Request,
  _schema: S,
  source: ValidationSource = 'body'
): ZodInfer<S> {
  const container = (req as Request & { valid?: ValidContainer }).valid;
  const value = container?.[source];
  if (value === undefined) {
    throw new Error(
      `getValid(${source}) called without matching validate() middleware on ${req.method} ${req.path}`
    );
  }
  return value as ZodInfer<S>;
}
