import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';

export interface RateDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the window resets. */
  resetSeconds: number;
}

const WINDOW_MS = 60_000;

/**
 * Requests per minute per API key, in fixed one-minute windows. With REDIS_URL the count is shared
 * by every API process (INCR on a key that expires with the window); without it each process counts
 * on its own. If Redis fails, requests are counted in memory rather than refused.
 */
@Injectable()
export class RateLimiter implements OnApplicationShutdown {
  private readonly logger = new Logger(RateLimiter.name);
  private readonly redis?: Redis;
  private readonly local = new Map<string, { window: number; count: number }>();

  constructor() {
    const url = process.env.REDIS_URL;
    if (url) {
      this.redis = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 1, enableOfflineQueue: false });
      this.redis.on('error', (err) => this.logger.debug(`Redis: ${err.message}`));
    }
  }

  async take(keyId: string, limit: number, now = Date.now()): Promise<RateDecision> {
    const window = Math.floor(now / WINDOW_MS);
    const resetSeconds = Math.ceil(((window + 1) * WINDOW_MS - now) / 1000);
    let count: number;
    try {
      if (!this.redis || this.redis.status !== 'ready') throw new Error('not ready');
      const key = `doccheck:rate:${keyId}:${window}`;
      const [[, n]] = (await this.redis.multi().incr(key).pexpire(key, WINDOW_MS * 2).exec()) as [[null, number], unknown];
      count = n;
    } catch {
      count = this.countLocally(keyId, window);
    }
    return { allowed: count <= limit, limit, remaining: Math.max(0, limit - count), resetSeconds };
  }

  private countLocally(keyId: string, window: number): number {
    const entry = this.local.get(keyId);
    if (!entry || entry.window !== window) {
      this.local.set(keyId, { window, count: 1 });
      if (this.local.size > 10_000) for (const [k, v] of this.local) if (v.window !== window) this.local.delete(k);
      return 1;
    }
    return ++entry.count;
  }

  async onApplicationShutdown() {
    await this.redis?.quit().catch(() => undefined);
  }
}
