import { describe, expect, it } from 'vitest';
import { signPayload } from '@doccheck/integrations';
import { DocCheckApiError, DocCheckClient, verifyWebhook } from './index';

/** A fetch that records requests and answers from a list. */
function fakeFetch(answers: (Response | (() => Response))[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const a = answers.shift()!;
    return typeof a === 'function' ? a() : a;
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

describe('DocCheckClient', () => {
  it('sends the key, the idempotency key and JSON, and reads the rate limit', async () => {
    const f = fakeFetch([json(201, { id: 's1', status: 'RECEIVED', documents: [], createdAt: 'x' }, { 'ratelimit-limit': '120', 'ratelimit-remaining': '119', 'ratelimit-reset': '30' })]);
    const dc = new DocCheckClient({ baseUrl: 'https://dc.example/', apiKey: 'dck_abc', fetch: f.fn });
    const s = await dc.createShipment({ reference: 'PO-1', destination: 'CA' }, { idempotencyKey: 'po-1' });
    expect(s.id).toBe('s1');
    expect(f.calls[0]!.url).toBe('https://dc.example/api/v1/shipments');
    expect(f.calls[0]!.init.headers).toMatchObject({ authorization: 'Bearer dck_abc', 'idempotency-key': 'po-1', 'content-type': 'application/json' });
    expect(JSON.parse(f.calls[0]!.init.body as string)).toEqual({ reference: 'PO-1', destination: 'CA' });
    expect(dc.rateLimit).toEqual({ limit: 120, remaining: 119, resetSeconds: 30 });
  });

  it('builds query strings and multipart uploads', async () => {
    const f = fakeFetch([json(200, { items: [], total: 0, limit: 5, offset: 0 }), json(202, { documents: [] }), json(200, { id: 'v' })]);
    const dc = new DocCheckClient({ baseUrl: 'https://dc.example', apiKey: 'k', fetch: f.fn });
    await dc.listShipments({ status: 'attention', limit: 5 });
    await dc.uploadDocuments('s 1', [{ name: 'invoice.pdf', data: new TextEncoder().encode('%PDF-1.4') }]);
    await dc.validate('s1', { wait: true, agent: false });
    expect(f.calls.map((c) => c.url)).toEqual([
      'https://dc.example/api/v1/shipments?status=attention&limit=5',
      'https://dc.example/api/v1/shipments/s%201/documents',
      'https://dc.example/api/v1/shipments/s1/validate?wait=true&agent=false',
    ]);
    const form = f.calls[1]!.init.body as FormData;
    expect((form.get('files') as File).name).toBe('invoice.pdf');
  });

  it('retries after a 429 and throws the API error otherwise', async () => {
    const f = fakeFetch([json(429, { statusCode: 429, error: 'Too Many Requests', message: 'slow down' }, { 'retry-after': '1' }), json(404, { statusCode: 404, error: 'Not Found', message: 'Shipment x not found' })]);
    const dc = new DocCheckClient({ baseUrl: 'https://dc.example', apiKey: 'k', fetch: f.fn });
    const err = await dc.getShipment('x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DocCheckApiError);
    expect((err as DocCheckApiError).status).toBe(404);
    expect((err as DocCheckApiError).message).toBe('Shipment x not found');
    expect(f.calls).toHaveLength(2);
  });
});

describe('verifyWebhook', () => {
  const body = JSON.stringify({ id: 'e1', type: 'ping', createdAt: '2026-10-16T00:00:00Z', data: { message: 'hi' } });

  it('accepts what the server signs and returns the event', () => {
    const header = signPayload('whsec_x', body, 1_800_000_000);
    expect(verifyWebhook('whsec_x', body, header, { now: 1_800_000_010 }).type).toBe('ping');
    expect(verifyWebhook('whsec_x', Buffer.from(body), header, { now: 1_800_000_010 }).id).toBe('e1');
  });

  it('throws on a wrong secret, a changed body, an old timestamp or no header', () => {
    const header = signPayload('whsec_x', body, 1_800_000_000);
    expect(() => verifyWebhook('whsec_y', body, header, { now: 1_800_000_000 })).toThrow(/does not match/);
    expect(() => verifyWebhook('whsec_x', body + ' ', header, { now: 1_800_000_000 })).toThrow(/does not match/);
    expect(() => verifyWebhook('whsec_x', body, header, { now: 1_800_001_000 })).toThrow(/too old/);
    expect(() => verifyWebhook('whsec_x', body, null)).toThrow(/Missing/);
  });
});
