import { BadRequestException, Inject, Injectable, Logger, NotFoundException, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { checkPattern, isIngestible, referenceFor, type GroupBy } from '@doccheck/integrations';
import type { Destination, ShipmentDocument } from '@doccheck/schemas';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { isDemo } from '../demo/demo-mode';
import { open, seal, type Sealed } from '../messaging/secret-box';
import { ShipmentsService } from '../shipments/shipments.service';
import { checkConfig, openSource, type SourceConfig, type SourceKind } from './ingestion-sources';

const TICK_MS = 15_000;
const MAX_PDF_BYTES = 20 * 1024 * 1024;
/** A dropped file joins a shipment with the same reference created within this many days. */
const REFERENCE_DAYS = 120;

export interface SourceInput {
  name: string;
  kind: SourceKind;
  config: Record<string, unknown>;
  /** Password, private key or secret access key; undefined keeps the saved one. */
  secret?: string;
  groupBy: GroupBy;
  pattern?: string | null;
  destination?: Destination | null;
  validate: boolean;
  pollSeconds: number;
  active: boolean;
}

export interface SourceView extends Omit<SourceInput, 'secret'> {
  id: string;
  hasSecret: boolean;
  lastPolledAt: string | null;
  lastError: string | null;
  createdAt: string;
  recent: { path: string; reference: string | null; status: string; shipmentId: string | null; error: string | null; createdAt: string }[];
}

/**
 * Folder ingestion: every source is listed on its schedule; each new PDF (by path and size/date) is
 * grouped by the reference its folder or name gives, added to the account's shipment with that
 * reference (or a new one), extracted, and validated once its documents are read when the source
 * says so and the shipment has a destination. Files are never moved or deleted at the source.
 */
@Injectable()
export class IngestionService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(IngestionService.name);
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly shipments: ShipmentsService,
  ) {}

  onApplicationBootstrap() {
    if (isDemo() || process.env.INGESTION_ENABLED === 'false') return;
    this.timer = setInterval(() => void this.tick(), Number(process.env.INGESTION_TICK_MS ?? TICK_MS) || TICK_MS);
    this.timer.unref();
  }

  async onApplicationShutdown() {
    clearInterval(this.timer);
    await this.running;
  }

  private check(input: SourceInput) {
    const reason = checkConfig(input.kind, input.config) ?? (input.groupBy === 'filename' && input.pattern ? checkPattern(input.pattern) : null);
    if (reason) throw new BadRequestException(reason);
  }

  /** Only the fields of the kind are kept: nothing else typed into the form is stored. */
  private configOf(kind: SourceKind, c: Record<string, unknown>): SourceConfig {
    const str = (k: string) => (typeof c[k] === 'string' && (c[k] as string).trim() ? (c[k] as string).trim() : undefined);
    if (kind === 'local') return { path: str('path')! };
    if (kind === 's3') return { bucket: str('bucket')!, prefix: str('prefix'), region: str('region'), endpoint: str('endpoint'), accessKeyId: str('accessKeyId')! };
    return { host: str('host')!, port: typeof c.port === 'number' ? c.port : undefined, username: str('username')!, path: str('path')! };
  }

  async create(accountId: string, input: SourceInput): Promise<SourceView> {
    this.check(input);
    if (input.kind !== 'local' && !input.secret) throw new BadRequestException(input.kind === 's3' ? 'Enter the secret access key' : 'Enter the password or private key');
    const id = randomUUID();
    await this.pool.query(
      `insert into ingestion_sources (id, account_id, name, kind, config, secret, group_by, pattern, destination, validate, poll_seconds, active)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [id, accountId, input.name, input.kind, JSON.stringify(this.configOf(input.kind, input.config)), input.secret ? JSON.stringify(seal(input.secret)) : null, input.groupBy, input.pattern || null, input.destination ?? null, input.validate, input.pollSeconds, input.active],
    );
    return this.get(accountId, id);
  }

  async update(accountId: string, id: string, input: SourceInput): Promise<SourceView> {
    this.check(input);
    const { rowCount } = await this.pool.query(
      `update ingestion_sources set name = $3, kind = $4, config = $5, secret = coalesce($6, secret), group_by = $7, pattern = $8, destination = $9, validate = $10, poll_seconds = $11, active = $12, last_error = null
       where id = $1 and account_id = $2`,
      [id, accountId, input.name, input.kind, JSON.stringify(this.configOf(input.kind, input.config)), input.secret ? JSON.stringify(seal(input.secret)) : null, input.groupBy, input.pattern || null, input.destination ?? null, input.validate, input.pollSeconds, input.active],
    );
    if (!rowCount) throw new NotFoundException(`Source ${id} not found`);
    return this.get(accountId, id);
  }

  async remove(accountId: string, id: string) {
    const { rowCount } = await this.pool.query('delete from ingestion_sources where id = $1 and account_id = $2', [id, accountId]);
    if (!rowCount) throw new NotFoundException(`Source ${id} not found`);
  }

  async list(accountId: string): Promise<SourceView[]> {
    const { rows } = await this.pool.query('select id from ingestion_sources where account_id = $1 order by created_at', [accountId]);
    return Promise.all(rows.map((r) => this.get(accountId, r.id)));
  }

  async get(accountId: string, id: string): Promise<SourceView> {
    const { rows } = await this.pool.query('select * from ingestion_sources where id = $1 and account_id = $2', [id, accountId]);
    const r = rows[0];
    if (!r) throw new NotFoundException(`Source ${id} not found`);
    const files = await this.pool.query('select * from ingested_files where source_id = $1 order by created_at desc limit 20', [id]);
    return {
      id: r.id,
      name: r.name,
      kind: r.kind,
      config: r.config,
      hasSecret: !!r.secret,
      groupBy: r.group_by,
      pattern: r.pattern,
      destination: r.destination,
      validate: r.validate,
      pollSeconds: r.poll_seconds,
      active: r.active,
      lastPolledAt: r.last_polled_at ? new Date(r.last_polled_at).toISOString() : null,
      lastError: r.last_error,
      createdAt: new Date(r.created_at).toISOString(),
      recent: files.rows.map((f) => ({ path: f.path, reference: f.reference, status: f.status, shipmentId: f.shipment_id, error: f.error, createdAt: new Date(f.created_at).toISOString() })),
    };
  }

  /** Lists the source with the saved (or typed) settings: how many PDFs it sees, and the references they give. */
  async test(accountId: string, input: SourceInput & { id?: string }) {
    this.check(input);
    let secret = input.secret;
    if (!secret && input.id) {
      const { rows } = await this.pool.query('select secret from ingestion_sources where id = $1 and account_id = $2', [input.id, accountId]);
      secret = rows[0]?.secret ? open(rows[0].secret as Sealed) : undefined;
    }
    const source = openSource(input.kind, this.configOf(input.kind, input.config), secret);
    try {
      const files = (await source.list()).filter((f) => isIngestible(f.path));
      return {
        ok: true,
        pdfs: files.length,
        sample: files.slice(0, 10).map((f) => ({ path: f.path, reference: referenceFor(f.path, input.groupBy, input.pattern || undefined) })),
      };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    } finally {
      await source.close();
    }
  }

  /** Polls now, whatever the schedule. */
  async pollNow(accountId: string, id: string) {
    const { rows } = await this.pool.query('select * from ingestion_sources where id = $1 and account_id = $2', [id, accountId]);
    if (!rows[0]) throw new NotFoundException(`Source ${id} not found`);
    await this.poll(rows[0]);
    return this.get(accountId, id);
  }

  tick(): Promise<void> {
    if (this.running) return this.running;
    this.running = (async () => {
      try {
        for (;;) {
          // Claimed by moving last_polled_at, so another process skips it.
          const { rows } = await this.pool.query(
            `update ingestion_sources set last_polled_at = now() where id = (
               select id from ingestion_sources where active and (last_polled_at is null or last_polled_at < now() - poll_seconds * interval '1 second')
               order by last_polled_at nulls first limit 1 for update skip locked)
             returning *`,
          );
          if (!rows[0]) return;
          await this.poll(rows[0]);
        }
      } catch (err) {
        this.logger.warn(`Folder ingestion tick failed: ${(err as Error).message}`);
      } finally {
        this.running = undefined;
      }
    })();
    return this.running;
  }

  private async poll(src: Record<string, any>) {
    let source;
    try {
      source = openSource(src.kind, src.config, src.secret ? open(src.secret as Sealed) : undefined);
      const listed = (await source.list()).filter((f) => isIngestible(f.path));
      const seen = new Set(
        (await this.pool.query<{ path: string; version: string }>('select path, version from ingested_files where source_id = $1 and path = any($2)', [src.id, listed.map((f) => f.path)])).rows.map((r) => `${r.path}\u0000${r.version}`),
      );
      const fresh = listed.filter((f) => !seen.has(`${f.path}\u0000${f.version}`));
      const groups = new Map<string, typeof fresh>();
      for (const f of fresh) {
        const reference = referenceFor(f.path, src.group_by, src.pattern ?? undefined);
        if (!reference || f.size > MAX_PDF_BYTES) {
          await this.record(src.id, f, reference, 'skipped', null, null, reference ? 'Larger than 20 MB' : 'The folder or file name gives no reference');
          continue;
        }
        groups.set(reference, [...(groups.get(reference) ?? []), f]);
      }
      for (const [reference, files] of groups) await this.importGroup(src, source, reference, files);
      await this.pool.query('update ingestion_sources set last_polled_at = now(), last_error = null where id = $1', [src.id]);
    } catch (err) {
      const message = (err as Error).message.slice(0, 500);
      this.logger.warn(`Source ${src.name}: ${message}`);
      await this.pool.query('update ingestion_sources set last_polled_at = now(), last_error = $2 where id = $1', [src.id, message]);
    } finally {
      await source?.close();
    }
  }

  private async importGroup(src: Record<string, any>, source: ReturnType<typeof openSource>, reference: string, files: { path: string; version: string; size: number }[]) {
    const userId: string = src.account_id;
    const read: { f: (typeof files)[number]; bytes: Buffer }[] = [];
    for (const f of files) {
      try {
        const bytes = await source.read(f.path);
        if (!bytes.subarray(0, 5).toString('latin1').startsWith('%PDF')) await this.record(src.id, f, reference, 'skipped', null, null, 'Not a PDF');
        else read.push({ f, bytes });
      } catch (err) {
        await this.record(src.id, f, reference, 'failed', null, null, (err as Error).message.slice(0, 300));
      }
    }
    if (!read.length) return;
    const { rows } = await this.pool.query<{ id: string }>(
      `select id from shipments where user_id = $1 and reference = $2 and created_at > now() - interval '${REFERENCE_DAYS} days' order by created_at desc limit 1`,
      [userId, reference],
    );
    const shipmentId = rows[0]?.id ?? (await this.shipments.create({ reference, destination: src.destination ?? undefined }, userId)).id;
    try {
      const documents = (await this.shipments.addDocuments(shipmentId, read.map((r) => ({ name: r.f.path.split('/').at(-1)!, bytes: r.bytes })))).documents as ShipmentDocument[];
      for (const [i, r] of read.entries()) await this.record(src.id, r.f, reference, 'imported', shipmentId, documents[i]!.id, null);
      if (src.validate) void this.validateWhenRead(shipmentId);
    } catch (err) {
      for (const r of read) await this.record(src.id, r.f, reference, 'failed', shipmentId, null, (err as Error).message.slice(0, 300));
    }
  }

  /** Validates once nothing of the shipment is left to extract (and it has a destination). */
  private async validateWhenRead(shipmentId: string) {
    const deadline = Date.now() + 30 * 60_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000).unref());
      const { rows } = await this.pool.query(`select count(*)::int as n from documents where shipment_id = $1 and status in ('QUEUED', 'EXTRACTING')`, [shipmentId]);
      if (rows[0].n > 0) continue;
      const shipment = await this.shipments.get(shipmentId).catch(() => null);
      if (!shipment?.destination) return;
      await this.shipments.validate(shipmentId).catch((err: Error) => this.logger.warn(`Validating ${shipmentId} after ingestion failed: ${err.message}`));
      return;
    }
  }

  private async record(sourceId: string, f: { path: string; version: string }, reference: string | null, status: 'imported' | 'skipped' | 'failed', shipmentId: string | null, documentId: string | null, error: string | null) {
    await this.pool.query(
      `insert into ingested_files (id, source_id, path, version, reference, shipment_id, document_id, status, error) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (source_id, path, version) do nothing`,
      [randomUUID(), sourceId, f.path, f.version, reference, shipmentId, documentId, status, error],
    );
  }
}
