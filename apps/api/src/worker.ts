import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { redis } from './lib/redis';
import { startAnalyzeJobWorker } from './workers/analyzeJob.worker';

const worker = startAnalyzeJobWorker();
logger.info('analyze-job worker started');

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'worker shutting down');
  const force = setTimeout(() => process.exit(1), 30_000);
  force.unref();
  await worker.close(); // waits for in-flight jobs
  await prisma.$disconnect();
  await redis.quit().catch(() => undefined);
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandledRejection'));
