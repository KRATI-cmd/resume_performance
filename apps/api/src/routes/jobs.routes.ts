import { Router, type Response } from 'express';
import { Prisma, type JobApplication } from '@prisma/client';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { enqueueAnalyzeJob } from '../lib/queue';
import { getPubSubHub, jobChannel, type JobEvent } from '../lib/redis';
import { computeJdHash } from '../lib/text';
import { asyncHandler, requireUser } from '../middleware/common';
import { analyzeBodySchema, idParamSchema } from '../schemas/http.schema';

export const jobsRouter = Router();

jobsRouter.use(requireUser);

async function enqueueOrFail(application: JobApplication): Promise<void> {
  try {
    await enqueueAnalyzeJob({ applicationId: application.id, userId: application.userId });
  } catch (err) {
    logger.error({ err, applicationId: application.id }, 'failed to enqueue analyze-job');
    await prisma.jobApplication.update({
      where: { id: application.id },
      data: { status: 'FAILED', errorMessage: 'Failed to enqueue job' },
    });
    throw new AppError(503, 'Job queue unavailable, please retry', 'QUEUE_UNAVAILABLE');
  }
}

/**
 * POST /api/v1/jobs/analyze
 *  - completed application with same (userId, jdHash) -> 200 { cached: true }
 *  - in flight                                        -> 202 { cached: false } (no duplicate job)
 *  - new, or previously FAILED                        -> enqueue, 202 { cached: false }
 */
jobsRouter.post(
  '/analyze',
  asyncHandler(async (req, res) => {
    const { sourceUrl, rawJdText, resumeId } = analyzeBodySchema.parse(req.body);
    const userId = req.userId;
    const jdHash = computeJdHash(rawJdText);
    const where = { userId_jdHash: { userId, jdHash } };

    if (resumeId) {
      const owned = await prisma.resume.findFirst({ where: { id: resumeId, userId }, select: { id: true } });
      if (!owned) throw new AppError(404, 'Resume not found', 'NOT_FOUND');
    }

    let application = await prisma.jobApplication.findUnique({ where });

    // A completed result is reused unless the user explicitly asks for a different resume.
    const differentResume = Boolean(resumeId) && application?.resumeId !== resumeId;

    if (application?.status === 'COMPLETED' && !differentResume) {
      res.status(200).json({ cached: true, application });
      return;
    }

    if (application?.status === 'PROCESSING') {
      res.status(202).json({ cached: false, application });
      return;
    }

    if (application?.status === 'FAILED' || application?.status === 'COMPLETED') {
      application = await prisma.jobApplication.update({
        where: { id: application.id },
        data: { status: 'PROCESSING', errorMessage: null, sourceUrl, resumeId: resumeId ?? null, resumeAutoSelected: false },
      });
      await enqueueOrFail(application);
      res.status(202).json({ cached: false, application });
      return;
    }

    try {
      application = await prisma.jobApplication.create({
        data: { userId, jdHash, sourceUrl, rawJdText, status: 'PROCESSING', resumeId: resumeId ?? null },
      });
    } catch (err) {
      // A concurrent identical request won the unique-constraint race: return its record.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const winner = await prisma.jobApplication.findUnique({ where });
        if (winner) {
          res.status(winner.status === 'COMPLETED' ? 200 : 202).json({
            cached: winner.status === 'COMPLETED',
            application: winner,
          });
          return;
        }
      }
      throw err;
    }

    await enqueueOrFail(application);
    res.status(202).json({ cached: false, application });
  }),
);

/** GET /api/v1/jobs — the caller's applications, newest first (heavy fields omitted). */
jobsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const applications = await prisma.jobApplication.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      omit: { rawJdText: true, tailoredBullets: true, outreachDraft: true },
    });
    res.json({ applications });
  }),
);

jobsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const application = await prisma.jobApplication.findFirst({ where: { id, userId: req.userId } });
    if (!application) throw new AppError(404, 'Application not found', 'NOT_FOUND');
    res.json({ application });
  }),
);

const HEARTBEAT_MS = 15_000;

function writeEvent(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** GET /api/v1/jobs/:id/stream — SSE of PROCESSING -> COMPLETED | FAILED, fed by Redis Pub/Sub. */
jobsRouter.get(
  '/:id/stream',
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const userId = req.userId;

    const initial = await prisma.jobApplication.findFirst({ where: { id, userId } });
    if (!initial) throw new AppError(404, 'Application not found', 'NOT_FOUND');

    res.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write('retry: 3000\n\n');

    let closed = false;
    let unsubscribe: (() => Promise<void>) | undefined;
    const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);

    const close = (): void => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      void unsubscribe?.().catch((err) => logger.warn({ err }, 'sse unsubscribe failed'));
      res.end();
    };

    const isTerminal = (status: string) => status === 'COMPLETED' || status === 'FAILED';

    req.on('close', close);

    // 1) Subscribe first so no event published between the DB read and the subscribe is lost.
    const unsub = await getPubSubHub().subscribe(jobChannel(id), (message) => {
      if (closed) return;
      const event = JSON.parse(message) as JobEvent;
      writeEvent(res, 'status', event);
      if (isTerminal(event.status)) close();
    });
    unsubscribe = unsub;
    if (closed) {
      await unsub();
      return;
    }

    // 2) Then re-read state: covers jobs that finished before we subscribed.
    const current = await prisma.jobApplication.findFirst({ where: { id, userId } });
    if (!current) {
      close();
      return;
    }
    const snapshot: JobEvent = {
      applicationId: current.id,
      status: current.status,
      ...(isTerminal(current.status) ? { application: current } : {}),
      ...(current.status === 'FAILED' && current.errorMessage ? { error: current.errorMessage } : {}),
    };
    writeEvent(res, 'status', snapshot);
    if (isTerminal(current.status)) close();
  }),
);
