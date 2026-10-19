import { describe, expect, it } from 'vitest';
import { redisUrl } from './redis-url';

describe('redisUrl', () => {
  it('uses REDIS_URL when set', () => {
    expect(redisUrl({ REDIS_URL: 'redis://cache:6379' })).toBe('redis://cache:6379');
  });

  it('runs without Redis when unset, empty or turned off', () => {
    for (const REDIS_URL of [undefined, '', '  ', 'off', 'none', 'FALSE']) expect(redisUrl({ REDIS_URL })).toBeUndefined();
  });

  it('ignores REDIS_URL in the read-only demo', () => {
    expect(redisUrl({ REDIS_URL: 'redis://localhost:6379', DEMO_READONLY: 'true' })).toBeUndefined();
  });
});
