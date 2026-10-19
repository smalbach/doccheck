import { isDemo } from './demo/demo-mode';

/**
 * The Redis to use for queues and shared rate limits, or undefined to run without one (extraction
 * in-process, webhook deliveries by polling, rate limits counted per process). REDIS_URL empty,
 * "off", "none" or "false" means no Redis, and so does the read-only demo, which never needs a queue:
 * a REDIS_URL copied there from a local .env would otherwise retry localhost:6379 forever.
 */
export function redisUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const url = env.REDIS_URL?.trim();
  if (!url || ['off', 'none', 'false'].includes(url.toLowerCase())) return undefined;
  if (isDemo(env)) return undefined;
  return url;
}
