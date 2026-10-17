import { GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { lookup } from 'node:dns/promises';
import { readdir, readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import SftpClient from 'ssh2-sftp-client';
import { allowPrivateUrls, checkUrl, isBlockedAddress } from './safe-fetch';

/** A file in a watched place: its path under the watched prefix ("/" separators) and a version that changes when it is replaced. */
export interface SourceFile {
  path: string;
  version: string;
  size: number;
}

/** Lists and reads the files of a watched place. */
export interface IngestionSource {
  list(): Promise<SourceFile[]>;
  read(path: string): Promise<Buffer>;
  close(): Promise<void>;
}

export type SourceKind = 'sftp' | 'local' | 's3';

export interface SftpConfig { host: string; port?: number; username: string; path: string }
export interface LocalConfig { path: string }
export interface S3Config { bucket: string; prefix?: string; region?: string; endpoint?: string; accessKeyId: string }
export type SourceConfig = SftpConfig | LocalConfig | S3Config;

const MAX_FILES = 2000;
const MAX_DEPTH = 4;

/** Local folders must be inside INGEST_LOCAL_ROOT (default .data/inbox), so an account cannot read the server's other files. */
export const localRoot = () => resolve(process.env.INGEST_LOCAL_ROOT ?? '.data/inbox');

export function resolveLocal(path: string): string {
  const root = localRoot();
  const full = resolve(root, path);
  const rel = relative(root, full);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`The folder must be inside ${root}`);
  return full;
}

class LocalSource implements IngestionSource {
  private readonly root: string;
  constructor(cfg: LocalConfig) {
    this.root = resolveLocal(cfg.path);
  }

  async list(): Promise<SourceFile[]> {
    const out: SourceFile[] = [];
    const walk = async (dir: string, depth: number) => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (out.length >= MAX_FILES || entry.name.startsWith('.')) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory() && depth < MAX_DEPTH) await walk(full, depth + 1);
        else if (entry.isFile()) {
          const s = await stat(full);
          out.push({ path: relative(this.root, full).split(sep).join('/'), version: `${s.size}:${Math.floor(s.mtimeMs)}`, size: s.size });
        }
      }
    };
    await walk(this.root, 0);
    return out;
  }

  read(path: string) {
    return readFile(resolveLocal(join(relative(localRoot(), this.root), path)));
  }

  async close() {}
}

class S3Source implements IngestionSource {
  private readonly client: S3Client;
  private readonly prefix: string;
  constructor(private readonly cfg: S3Config, secretAccessKey: string) {
    this.client = new S3Client({ region: cfg.region || 'us-east-1', ...(cfg.endpoint ? { endpoint: cfg.endpoint, forcePathStyle: true } : {}), credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey } });
    this.prefix = (cfg.prefix ?? '').replace(/^\/+/, '');
  }

  async list(): Promise<SourceFile[]> {
    const out: SourceFile[] = [];
    let token: string | undefined;
    do {
      const page = await this.client.send(new ListObjectsV2Command({ Bucket: this.cfg.bucket, Prefix: this.prefix, ContinuationToken: token }));
      for (const o of page.Contents ?? []) {
        if (!o.Key || o.Key.endsWith('/')) continue;
        out.push({ path: o.Key.slice(this.prefix.length).replace(/^\/+/, ''), version: `${o.ETag ?? ''}:${o.Size ?? 0}`, size: o.Size ?? 0 });
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token && out.length < MAX_FILES);
    return out;
  }

  async read(path: string) {
    const key = this.prefix ? `${this.prefix.replace(/\/?$/, '/')}${path}` : path;
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
    return Buffer.from(await res.Body!.transformToByteArray());
  }

  async close() {
    this.client.destroy();
  }
}

class SftpSource implements IngestionSource {
  private readonly client = new SftpClient();
  private connected?: Promise<unknown>;
  constructor(private readonly cfg: SftpConfig, private readonly secret: string) {}

  private connect() {
    this.connected ??= (async () => {
      // The same address rule as webhooks: no private or local hosts unless allowed.
      const addresses = await lookup(this.cfg.host, { all: true });
      if (!allowPrivateUrls() && addresses.some((a) => isBlockedAddress(a.address))) throw new Error(`${this.cfg.host} resolves to a private or local address`);
      const key = /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(this.secret);
      return this.client.connect({ host: addresses[0]!.address, port: this.cfg.port ?? 22, username: this.cfg.username, ...(key ? { privateKey: this.secret } : { password: this.secret }), readyTimeout: 15_000 });
    })();
    return this.connected;
  }

  async list(): Promise<SourceFile[]> {
    await this.connect();
    const root = this.cfg.path.replace(/\/+$/, '') || '/';
    const out: SourceFile[] = [];
    const walk = async (dir: string, depth: number) => {
      for (const e of await this.client.list(dir)) {
        if (out.length >= MAX_FILES || e.name.startsWith('.')) continue;
        const full = `${dir.replace(/\/$/, '')}/${e.name}`;
        if (e.type === 'd' && depth < MAX_DEPTH) await walk(full, depth + 1);
        else if (e.type === '-') out.push({ path: full.slice(root.length).replace(/^\/+/, ''), version: `${e.size}:${e.modifyTime}`, size: e.size });
      }
    };
    await walk(root, 0);
    return out;
  }

  async read(path: string) {
    await this.connect();
    return (await this.client.get(`${this.cfg.path.replace(/\/+$/, '')}/${path}`)) as Buffer;
  }

  async close() {
    if (this.connected) await this.client.end().catch(() => undefined);
  }
}

/** Checks a configuration as typed. Returns the reason it is refused, or null. */
export function checkConfig(kind: SourceKind, cfg: Record<string, unknown>): string | null {
  const s = (k: string) => typeof cfg[k] === 'string' && (cfg[k] as string).trim().length > 0;
  if (kind === 'local') {
    if (!s('path')) return 'Enter the folder';
    try {
      resolveLocal(cfg.path as string);
    } catch (err) {
      return (err as Error).message;
    }
    return null;
  }
  if (kind === 's3') {
    if (!s('bucket') || !s('accessKeyId')) return 'Enter the bucket and the access key id';
    if (cfg.endpoint) return checkUrl(cfg.endpoint as string);
    return null;
  }
  if (!s('host') || !s('username') || !s('path')) return 'Enter the host, user and folder';
  if (cfg.port !== undefined && !(Number.isInteger(cfg.port) && (cfg.port as number) > 0 && (cfg.port as number) < 65536)) return 'The port must be 1 to 65535';
  return null;
}

export function openSource(kind: SourceKind, cfg: SourceConfig, secret: string | undefined): IngestionSource {
  if (kind === 'local') return new LocalSource(cfg as LocalConfig);
  if (!secret) throw new Error('The saved password or key cannot be read (the settings key changed?): enter it again');
  if (kind === 's3') return new S3Source(cfg as S3Config, secret);
  return new SftpSource(cfg as SftpConfig, secret);
}
