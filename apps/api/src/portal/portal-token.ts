import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { appUrl } from '../auth/app-url';
import { derivedKey } from '../messaging/secret-box';

/**
 * Supplier portal links (docs/PORTAL.md). A token is "<link id>.<HMAC-SHA256 of the id>", signed with a
 * key derived from SETTINGS_KEY: nobody can make one without the key, and the app can show a link
 * again without keeping it. The database holds only a SHA-256 of each token, so a copy of the
 * database opens nothing.
 */

/** Written in an email where the conversation's portal link goes; replaced only when the email is sent. */
export const LINK_PLACEHOLDER = '{{portal-link}}';

const HEX_ID = /^[0-9a-f]{32}$/;
const MAX_TOKEN = 128;

const signature = (hexId: string) => createHmac('sha256', derivedKey('portal-link')).update(hexId).digest('base64url');

/** The token of a link (the same every time for the same link). */
export function linkToken(linkId: string): string {
  const hex = linkId.replace(/-/g, '').toLowerCase();
  return `${hex}.${signature(hex)}`;
}

/** The link id a token names when its signature is right (compared in constant time), else null. */
export function verifyToken(token: unknown): string | null {
  if (typeof token !== 'string' || token.length > MAX_TOKEN) return null;
  const [hex, mac, extra] = token.split('.');
  if (!hex || !mac || extra !== undefined || !HEX_ID.test(hex)) return null;
  const expected = Buffer.from(signature(hex));
  const given = Buffer.from(mac);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** What is stored for a token. */
export const tokenHash = (token: string): Buffer => createHash('sha256').update(token).digest();

/** The stored hash matches the token, in constant time. */
export function hashMatches(stored: Buffer, token: string): boolean {
  const given = tokenHash(token);
  return stored.length === given.length && timingSafeEqual(stored, given);
}

/** The portal page of a token, under the web app's address (in the fragment: never sent to a server or in a Referer). */
export function portalPath(token: string): string {
  return `/#/portal?t=${token}`;
}

export function portalUrl(token: string): string | undefined {
  const base = appUrl();
  return base ? `${base}${portalPath(token)}` : undefined;
}

/** A message's text with the placeholder replaced by the link (or the line dropped when there is none). */
export function expandLinks(text: string, url: string | undefined): string {
  if (!text.includes(LINK_PLACEHOLDER)) return text;
  if (url) return text.split(LINK_PLACEHOLDER).join(url);
  return text
    .split('\n')
    .filter((line) => !line.includes(LINK_PLACEHOLDER))
    .join('\n');
}
