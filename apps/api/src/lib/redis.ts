import IORedis, { Redis } from 'ioredis';
import { env } from '../config/env';
import { logger } from './logger';

/**
 * BullMQ requires `maxRetriesPerRequest: null` on blocking connections; we use the same
 * options for every connection for simplicity.
 */
export function createRedis(name: string): Redis {
  const client = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: true });
  client.on('error', (err) => logger.error({ err, connection: name }, 'redis connection error'));
  return client;
}

/** Shared connection for commands (publish, queue producer). */
export const redis = createRedis('main');

export const jobChannel = (applicationId: string) => `job:${applicationId}:events`;

export type JobEvent = {
  applicationId: string;
  status: 'PROCESSING' | 'COMPLETED' | 'FAILED';
  stage?: 'embedding' | 'retrieval' | 'generation' | 'saving';
  application?: unknown;
  error?: string;
};

export async function publishJobEvent(event: JobEvent): Promise<void> {
  await redis.publish(jobChannel(event.applicationId), JSON.stringify(event));
}

type Handler = (message: string) => void;

/**
 * Multiplexes many SSE listeners over a single Redis subscriber connection
 * (a subscribed connection cannot issue other commands).
 */
class PubSubHub {
  private readonly sub = createRedis('subscriber');
  private readonly handlers = new Map<string, Set<Handler>>();

  constructor() {
    this.sub.on('message', (channel: string, message: string) => {
      this.handlers.get(channel)?.forEach((h) => {
        try {
          h(message);
        } catch (err) {
          logger.error({ err, channel }, 'pubsub handler threw');
        }
      });
    });
  }

  async subscribe(channel: string, handler: Handler): Promise<() => Promise<void>> {
    let set = this.handlers.get(channel);
    const isNew = !set;
    if (!set) {
      set = new Set();
      this.handlers.set(channel, set);
    }
    set.add(handler);
    if (isNew) await this.sub.subscribe(channel);

    return async () => {
      const current = this.handlers.get(channel);
      if (!current) return;
      current.delete(handler);
      if (current.size === 0) {
        this.handlers.delete(channel);
        await this.sub.unsubscribe(channel);
      }
    };
  }

  async close(): Promise<void> {
    await this.sub.quit();
  }
}

let hub: PubSubHub | undefined;
export const getPubSubHub = (): PubSubHub => (hub ??= new PubSubHub());
export const closePubSubHub = async (): Promise<void> => {
  if (hub) await hub.close();
  hub = undefined;
};
