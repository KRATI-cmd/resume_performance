import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError, z } from 'zod';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId: string;
    }
  }
}

export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

const userIdSchema = z.string().uuid();

/**
 * Identifies the caller. Phase 1 uses an `x-user-id` header (or `?userId=` for
 * EventSource, which cannot set headers). Swap this for real auth (JWT/session)
 * without touching the routes: they only read `req.userId`.
 */
export const requireUser = asyncHandler(async (req, _res, next) => {
  const raw = req.header('x-user-id') ?? (typeof req.query.userId === 'string' ? req.query.userId : undefined);
  const parsed = userIdSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError(401, 'Missing or invalid x-user-id', 'UNAUTHENTICATED');
  }
  const user = await prisma.userProfile.findUnique({ where: { id: parsed.data }, select: { id: true } });
  if (!user) throw new AppError(401, 'Unknown user', 'UNAUTHENTICATED');
  req.userId = user.id;
  next();
});

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new AppError(404, `Route not found: ${req.method} ${req.path}`, 'NOT_FOUND'));
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (res.headersSent) {
    res.end();
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: err.flatten() },
    });
    return;
  }
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    logger.error({ err, path: req.path }, 'database error');
    res.status(500).json({ error: { code: 'DATABASE_ERROR', message: 'Database error' } });
    return;
  }
  if (err instanceof Error && err.name === 'MulterError') {
    const tooBig = (err as { code?: string }).code === 'LIMIT_FILE_SIZE';
    res.status(tooBig ? 413 : 400).json({
      error: { code: tooBig ? 'FILE_TOO_LARGE' : 'UPLOAD_ERROR', message: tooBig ? 'File is too large (max 5 MB)' : err.message },
    });
    return;
  }
  if ((err as { type?: string }).type === 'entity.too.large') {
    res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large (max 1 MB)' } });
    return;
  }
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Malformed JSON body' } });
    return;
  }
  logger.error({ err, path: req.path }, 'unhandled error');
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Internal server error' } });
};
