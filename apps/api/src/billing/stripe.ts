import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Stripe, strictly in test mode. Billing is on only when STRIPE_SECRET_KEY is a test key
 * (sk_test_… or rk_test_…), STRIPE_WEBHOOK_SECRET is set and at least one plan has a price
 * (STRIPE_PRICE_PRO, STRIPE_PRICE_BUSINESS). A live key turns billing off and says why: this
 * project never charges anyone. Only the account's email and id go to Stripe, never documents.
 */
export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  /** Plan id -> Stripe price id. */
  prices: Record<string, string>;
}

export type StripeSetup = { enabled: true; config: StripeConfig } | { enabled: false; reason: string };

/** Plans that can be bought, and the variable that holds each one's test price. */
export const PRICE_ENV: Record<string, string> = { pro: 'STRIPE_PRICE_PRO', business: 'STRIPE_PRICE_BUSINESS' };

export function stripeSetup(env: NodeJS.ProcessEnv = process.env): StripeSetup {
  const secretKey = env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) return { enabled: false, reason: 'STRIPE_SECRET_KEY is not set' };
  if (!/^(sk|rk)_test_\w+$/.test(secretKey)) return { enabled: false, reason: 'Only Stripe test-mode keys (sk_test_…) are accepted; billing is off' };
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!webhookSecret?.startsWith('whsec_')) return { enabled: false, reason: 'STRIPE_WEBHOOK_SECRET (whsec_…) is not set' };
  const prices: Record<string, string> = {};
  for (const [plan, name] of Object.entries(PRICE_ENV)) {
    const price = env[name]?.trim();
    if (price && /^price_\w+$/.test(price)) prices[plan] = price;
  }
  if (Object.keys(prices).length === 0) return { enabled: false, reason: 'No plan has a Stripe price (STRIPE_PRICE_PRO, STRIPE_PRICE_BUSINESS)' };
  return { enabled: true, config: { secretKey, webhookSecret, prices } };
}

export class StripeSignatureError extends Error {}

/**
 * Checks a webhook's Stripe-Signature header ("t=<unix>,v1=<hex hmac>,…") against the raw body:
 * HMAC-SHA256 of "<t>.<body>" with the endpoint secret, within `toleranceSec` of now.
 */
export function verifyStripeSignature(body: Buffer, header: string | undefined, secret: string, now = Date.now(), toleranceSec = 300): void {
  if (!header) throw new StripeSignatureError('Missing Stripe-Signature header');
  const parts = header.split(',').map((p) => p.trim().split('=') as [string, string]);
  const t = Number(parts.find(([k]) => k === 't')?.[1]);
  const signatures = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!Number.isFinite(t) || signatures.length === 0) throw new StripeSignatureError('Malformed Stripe-Signature header');
  if (Math.abs(now / 1000 - t) > toleranceSec) throw new StripeSignatureError('Stripe-Signature timestamp is too old');
  const expected = createHmac('sha256', secret).update(`${t}.`).update(body).digest();
  const ok = signatures.some((s) => {
    const given = Buffer.from(s, 'hex');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  if (!ok) throw new StripeSignatureError('Stripe-Signature does not match');
}

/** A header Stripe would send for `body`; for tests. */
export function signStripePayload(body: string, secret: string, now = Date.now()): string {
  const t = Math.floor(now / 1000);
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
}

/** Form-encodes nested params the way Stripe's API expects: line_items[0][price]=… */
export function formEncode(params: Record<string, unknown>, prefix = ''): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (typeof value === 'object') {
      out.push(...formEncode(Array.isArray(value) ? Object.fromEntries(value.map((v, i) => [String(i), v])) : (value as Record<string, unknown>), name));
    } else out.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`);
  }
  return out;
}

export class StripeApiError extends Error {}

/** One call to Stripe's REST API (no SDK). */
export async function stripeCall<T>(config: StripeConfig, path: string, params: Record<string, unknown>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`https://api.stripe.com/v1/${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.secretKey}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: formEncode(params).join('&'),
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    throw new StripeApiError(`Stripe is not reachable (${err instanceof Error ? err.message : String(err)})`);
  }
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } } & T;
  if (!res.ok) throw new StripeApiError(`Stripe ${res.status}: ${body.error?.message ?? 'request failed'}`);
  return body;
}
