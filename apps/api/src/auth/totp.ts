import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Time-based one-time passwords (RFC 6238: HMAC-SHA1, 6 digits, 30-second steps), as authenticator apps make them. */
const DIGITS = 6;
const STEP_SECONDS = 30;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error(`Not base32: ${ch}`);
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new 160-bit secret, base32 as apps take it. */
export const newTotpSecret = () => base32Encode(randomBytes(20));

/** The code for a counter (RFC 4226 dynamic truncation). */
export function hotp(secret: Buffer, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', secret).update(msg).digest();
  const offset = mac[mac.length - 1]! & 0xf;
  const code = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return String(code).padStart(DIGITS, '0');
}

export const totpCounter = (atMs: number) => Math.floor(atMs / 1000 / STEP_SECONDS);

export function totp(secretBase32: string, atMs = Date.now()): string {
  return hotp(base32Decode(secretBase32), totpCounter(atMs));
}

/**
 * The counter `code` matches within one step either side (clock drift), or null. The caller refuses a
 * counter already used, so a code cannot be replayed.
 */
export function verifyTotp(secretBase32: string, code: string, atMs = Date.now(), window = 1): number | null {
  const digits = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(digits)) return null;
  const secret = base32Decode(secretBase32);
  const now = totpCounter(atMs);
  for (let c = now - window; c <= now + window; c++) {
    if (timingSafeEqual(Buffer.from(hotp(secret, c)), Buffer.from(digits))) return c;
  }
  return null;
}

/** otpauth:// URL for the QR code or manual entry in an authenticator app. */
export function otpauthUrl(secretBase32: string, account: string, issuer = 'DocCheck'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

/** Ten single-use recovery codes, "xxxxx-xxxxx" in lowercase base32. */
export const newRecoveryCodes = (n = 10) =>
  Array.from({ length: n }, () => {
    const s = base32Encode(randomBytes(7)).slice(0, 10).toLowerCase();
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });

export const normalizeRecoveryCode = (code: string) => code.trim().toLowerCase().replace(/[\s-]/g, '');
