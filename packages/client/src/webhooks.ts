import { createHmac, timingSafeEqual } from 'node:crypto';
import type { WebhookEvent } from './types';

export const SIGNATURE_HEADER = 'doccheck-signature';

/**
 * Checks a webhook delivery: the DocCheck-Signature header ("t=<unix>,v1=<hex>") must be the
 * HMAC-SHA256 of "<t>.<raw body>" with the webhook's signing secret, and t within `toleranceSeconds`
 * of now (default 300) so an old delivery cannot be replayed. Pass the body exactly as received,
 * before parsing it. Returns the event, or throws.
 */
export function verifyWebhook<T = Record<string, unknown>>(secret: string, rawBody: string | Buffer, signatureHeader: string | undefined | null, { toleranceSeconds = 300, now = Math.floor(Date.now() / 1000) } = {}): WebhookEvent<T> {
  const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  const parts = (signatureHeader ?? '').split(',').map((p) => p.trim().split('='));
  const t = Number(parts.find(([k]) => k === 't')?.[1]);
  const sigs = parts.filter(([k, v]) => k === 'v1' && /^[0-9a-f]{64}$/.test(v ?? '')).map(([, v]) => Buffer.from(v!, 'hex'));
  if (!Number.isInteger(t) || !sigs.length) throw new Error('Missing or malformed DocCheck-Signature');
  if (Math.abs(now - t) > toleranceSeconds) throw new Error('DocCheck-Signature timestamp is too old or in the future');
  const expected = createHmac('sha256', secret).update(`${t}.${body}`).digest();
  if (!sigs.some((s) => timingSafeEqual(s, expected))) throw new Error('DocCheck-Signature does not match');
  return JSON.parse(body) as WebhookEvent<T>;
}
