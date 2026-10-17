import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';

/**
 * Outgoing requests to URLs a user typed (webhooks, chat alerts, tracking endpoints) must not reach
 * this server's own network: loopback, private ranges, link-local (cloud metadata at 169.254.169.254)
 * and the like are refused. The check runs inside the socket's DNS lookup, so the address that was
 * checked is the one connected to (a name that resolves differently a second time cannot slip past).
 * Redirects are not followed.
 *
 * INTEGRATIONS_ALLOW_PRIVATE_URLS=true lifts the address check, for a server inside a company network
 * that posts to internal systems, and for tests.
 */
// IPv4-mapped IPv6 (::ffff:a.b.c.d) is checked as the IPv4 address it maps (a BlockList rule for
// ::ffff:0:0/96 would match every IPv4 address).
const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blocked.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b::', 96]] as const) blocked.addSubnet(net, prefix, 'ipv6');

export const allowPrivateUrls = () => process.env.INTEGRATIONS_ALLOW_PRIVATE_URLS === 'true';

export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true;
  if (family === 6 && /^::ffff:/i.test(address)) {
    const rest = address.slice(7);
    const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(rest);
    const v4 = hex ? [parseInt(hex[1]!, 16) >> 8, parseInt(hex[1]!, 16) & 255, parseInt(hex[2]!, 16) >> 8, parseInt(hex[2]!, 16) & 255].join('.') : rest;
    if (isIP(v4) === 4) return blocked.check(v4, 'ipv4');
  }
  return blocked.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

export class UnsafeUrlError extends Error {}

/** Checks the shape of a URL a user typed: http(s), no credentials, and https unless private URLs are allowed. Returns the reason, or null. */
export function checkUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return 'Not a valid URL';
  }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && allowPrivateUrls())) return 'The URL must start with https://';
  if (u.username || u.password) return 'Put credentials in the secret, not in the URL';
  if (raw.length > 2000) return 'The URL is longer than 2000 characters';
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!allowPrivateUrls() && (host === 'localhost' || host.endsWith('.localhost') || (isIP(host) && isBlockedAddress(host)))) return 'The URL points at a private or local address';
  return null;
}

const guardedLookup: typeof dnsLookup = ((hostname: string, options: unknown, callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void) => {
  dnsLookup(hostname, { ...(typeof options === 'object' ? options : {}), all: true }, (err, addresses) => {
    if (err) return callback(err, []);
    const list = addresses as LookupAddress[];
    const bad = list.find((a) => isBlockedAddress(a.address));
    if (bad && !allowPrivateUrls()) return callback(Object.assign(new UnsafeUrlError(`${hostname} resolves to a private or local address`), { code: 'EUNSAFE' }), []);
    const wantsAll = typeof options === 'object' && (options as { all?: boolean }).all;
    if (wantsAll) return callback(null, list);
    callback(null, list[0]!.address, list[0]!.family);
  });
}) as typeof dnsLookup;

export interface SafeResponse {
  status: number;
  headers: IncomingMessage['headers'];
  /** The body, cut at maxBytes. */
  body: string;
}

/** One HTTP request to a user-given URL, with the address check, a timeout and a cap on the body read. */
export function safeRequest(url: string, init: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number; maxBytes?: number } = {}): Promise<SafeResponse> {
  const reason = checkUrl(url);
  if (reason) return Promise.reject(new UnsafeUrlError(reason));
  const u = new URL(url);
  const maxBytes = init.maxBytes ?? 64 * 1024;
  return new Promise((resolve, reject) => {
    const req = (u.protocol === 'https:' ? httpsRequest : httpRequest)(
      u,
      {
        method: init.method ?? 'GET',
        headers: { 'user-agent': 'DocCheck-Integrations/1', ...(init.body !== undefined ? { 'content-length': String(Buffer.byteLength(init.body)) } : {}), ...init.headers },
        lookup: guardedLookup,
        timeout: init.timeoutMs ?? 10_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (c: Buffer) => {
          if (size < maxBytes) chunks.push(c.subarray(0, maxBytes - size));
          size += c.length;
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error(`No answer within ${Math.round((init.timeoutMs ?? 10_000) / 1000)} s`)));
    req.on('error', (err: NodeJS.ErrnoException) => reject(err.code === 'EUNSAFE' ? new UnsafeUrlError(err.message) : err));
    if (init.body !== undefined) req.write(init.body);
    req.end();
  });
}
