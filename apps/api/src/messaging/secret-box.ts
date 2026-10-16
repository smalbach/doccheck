import { Logger } from '@nestjs/common';
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** A secret as stored in the database: AES-256-GCM, never the plain text. */
export interface Sealed {
  iv: string;
  tag: string;
  data: string;
}

let cached: Buffer | undefined;

/**
 * The key secrets are sealed with: SETTINGS_KEY (32 bytes as base64 or hex), or a key file made
 * once under .data/ (SETTINGS_KEY_FILE). Set SETTINGS_KEY on servers whose disk is not kept
 * (containers): without the same key, saved passwords cannot be read back and must be entered again.
 */
function key(): Buffer {
  if (cached) return cached;
  const fromEnv = process.env.SETTINGS_KEY;
  if (fromEnv) {
    const k = /^[0-9a-f]{64}$/i.test(fromEnv) ? Buffer.from(fromEnv, 'hex') : Buffer.from(fromEnv, 'base64');
    if (k.length !== 32) throw new Error('SETTINGS_KEY must be 32 bytes, as base64 or 64 hex characters');
    return (cached = k);
  }
  const file = resolve(process.env.SETTINGS_KEY_FILE ?? '.data/settings.key');
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, randomBytes(32).toString('base64'), { mode: 0o600 });
    Logger.warn(`SETTINGS_KEY is not set: made ${file} to seal saved passwords (keep it with the database)`, 'SecretBox');
  }
  chmodSync(file, 0o600);
  return (cached = Buffer.from(readFileSync(file, 'utf8').trim(), 'base64'));
}

export function seal(plain: string): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}

/** The plain text, or undefined when it was sealed with another key (or tampered with). */
export function open(sealed: Sealed): string | undefined {
  try {
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(sealed.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(sealed.data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return undefined;
  }
}

/** A key for another purpose (`label`), derived from the same secret: never the sealing key itself. */
export function derivedKey(label: string): Buffer {
  return Buffer.from(hkdfSync('sha256', key(), Buffer.alloc(0), `doccheck:${label}`, 32));
}
