import { Queue } from 'bullmq';
import { env } from '../config/env';
import { redis } from './redis';

export const ANALYZE_QUEUE = 'job-analysis';
export const ANALYZE_JOB_NAME = 'analyze-job';

export type AnalyzeJobData = {
  applicationId: string;
  userId: string;
};

export const analyzeQueue = new Queue<AnalyzeJobData>(ANALYZE_QUEUE, {
  connection: redis,
  defaultJobOptions: {
    attempts: env.JOB_MAX_ATTEMPTS,
    backoff: { type: 'exponential', delay: 3000 },
    removeOnComplete: { age: 3600, count: 1000 },
    removeOnFail: { age: 24 * 3600, count: 1000 },
  },
});

/**
 * Enqueue an analysis. The BullMQ jobId must not contain ':' and must be unique per
 * enqueue so that retrying a FAILED application is not de-duplicated against the old job.
 */
export function enqueueAnalyzeJob(data: AnalyzeJobData) {
  return analyzeQueue.add(ANALYZE_JOB_NAME, data, { jobId: `${data.applicationId}-${Date.now()}` });
}
