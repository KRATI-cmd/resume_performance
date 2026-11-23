import { Prisma } from '@prisma/client';
import { UnrecoverableError, Worker, type Job } from 'bullmq';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { ANALYZE_QUEUE, type AnalyzeJobData } from '../lib/queue';
import { createRedis, publishJobEvent, type JobEvent } from '../lib/redis';
import { findRelevantChunks, TOP_K_CHUNKS } from '../services/chunk.service';
import { embedText } from '../services/embedding.service';
import { generateTailoring } from '../services/jobAnalysis.service';

async function emitProgress(applicationId: string, stage: NonNullable<JobEvent['stage']>): Promise<void> {
  await publishJobEvent({ applicationId, status: 'PROCESSING', stage });
}

async function processAnalyzeJob(job: Job<AnalyzeJobData>): Promise<void> {
  const { applicationId, userId } = job.data;
  const startedAt = Date.now();
  const log = logger.child({ jobId: job.id, applicationId });

  const application = await prisma.jobApplication.findFirst({ where: { id: applicationId, userId } });
  if (!application) throw new UnrecoverableError(`JobApplication ${applicationId} not found`);
  if (application.status === 'COMPLETED') return;

  // 1) Embed the JD.
  await emitProgress(applicationId, 'embedding');
  const { vector, tokens: embeddingTokens } = await embedText(application.rawJdText);

  // 2) Hybrid RAG: cosine-similarity top-K over this user's verified experience.
  await emitProgress(applicationId, 'retrieval');
  const chunks = await findRelevantChunks(userId, vector, TOP_K_CHUNKS);
  if (chunks.length === 0) {
    throw new UnrecoverableError('No experience chunks found. Upload experience via POST /api/v1/profile/chunks first.');
  }
  log.info({ retrieved: chunks.length, topSimilarity: chunks[0]?.similarity }, 'retrieved chunks');

  // 3) Grounded generation, validated with Zod.
  await emitProgress(applicationId, 'generation');
  const { output, tokensUsed: llmTokens } = await generateTailoring({
    jdText: application.rawJdText,
    sourceUrl: application.sourceUrl,
    chunks,
  });

  // 4) Persist and announce.
  await emitProgress(applicationId, 'saving');
  const completed = await prisma.jobApplication.update({
    where: { id: applicationId },
    data: {
      status: 'COMPLETED',
      companyName: output.companyName,
      roleTitle: output.roleTitle,
      matchScore: output.matchScore,
      missingKeywords: output.missingKeywords,
      tailoredBullets: output.tailoredBullets as unknown as Prisma.InputJsonValue,
      outreachDraft: output.outreachDraft,
      tokensUsed: embeddingTokens + llmTokens,
      processingTimeMs: Date.now() - startedAt,
      errorMessage: null,
    },
  });

  await publishJobEvent({ applicationId, status: 'COMPLETED', application: completed });
  log.info({ tokensUsed: completed.tokensUsed, ms: completed.processingTimeMs }, 'analysis completed');
}

async function markFailed(applicationId: string, message: string): Promise<void> {
  const failed = await prisma.jobApplication.update({
    where: { id: applicationId },
    data: { status: 'FAILED', errorMessage: message.slice(0, 1000) },
  });
  await publishJobEvent({ applicationId, status: 'FAILED', application: failed, error: failed.errorMessage ?? message });
}

export function startAnalyzeJobWorker(): Worker<AnalyzeJobData> {
  const worker = new Worker<AnalyzeJobData>(ANALYZE_QUEUE, processAnalyzeJob, {
    connection: createRedis('worker'),
    concurrency: env.WORKER_CONCURRENCY,
  });

  worker.on('failed', (job, err) => {
    if (!job) return;
    const attempts = job.opts.attempts ?? 1;
    const exhausted = job.attemptsMade >= attempts || err instanceof UnrecoverableError;
    logger.error({ jobId: job.id, attemptsMade: job.attemptsMade, exhausted, err }, 'analyze-job failed');
    if (!exhausted) return;
    markFailed(job.data.applicationId, err.message).catch((e) =>
      logger.error({ err: e, applicationId: job.data.applicationId }, 'failed to mark application FAILED'),
    );
  });

  worker.on('error', (err) => logger.error({ err }, 'worker error'));
  return worker;
}
