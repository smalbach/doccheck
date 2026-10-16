import { createHmac, timingSafeEqual } from 'node:crypto';

/** Header every webhook delivery carries: "t=<unix seconds>,v1=<hex HMAC-SHA256>". */
export const SIGNATURE_HEADER = 'DocCheck-Signature';
/** A signature older (or newer) than this is refused by verifySignature: replayed deliveries fail. */
export const DEFAULT_TOLERANCE_SECONDS = 300;

/**
 * Signs a webhook body: HMAC-SHA256 with the subscription's secret over "<timestamp>.<raw body>".
 * The timestamp is part of what is signed, so it cannot be changed to replay an old delivery.
 */
export function signPayload(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)): string {
  return `t=${timestamp},v1=${hmac(secret, timestamp, body)}`;
}

export type VerifyResult = { ok: true; timestamp: number } | { ok: false; reason: 'malformed' | 'expired' | 'mismatch' };

/**
 * Checks a signature header against the raw body as received (before any JSON parsing). Several v1
 * values are accepted (one per secret while a secret is being rotated); any match passes.
 */
export function verifySignature(secret: string, body: string, header: string | undefined, opts: { toleranceSeconds?: number; now?: number } = {}): VerifyResult {
  const parts = (header ?? '').split(',').map((p) => p.trim().split('='));
  const t = Number(parts.find(([k]) => k === 't')?.[1]);
  const sigs = parts.filter(([k, v]) => k === 'v1' && /^[0-9a-f]{64}$/.test(v ?? '')).map(([, v]) => v!);
  if (!Number.isInteger(t) || sigs.length === 0) return { ok: false, reason: 'malformed' };
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - t) > (opts.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS)) return { ok: false, reason: 'expired' };
  const expected = Buffer.from(hmac(secret, t, body), 'hex');
  const match = sigs.some((s) => timingSafeEqual(Buffer.from(s, 'hex'), expected));
  return match ? { ok: true, timestamp: t } : { ok: false, reason: 'mismatch' };
}

function hmac(secret: string, timestamp: number, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}
