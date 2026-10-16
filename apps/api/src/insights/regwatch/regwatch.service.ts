import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { rulesCiting } from '@doccheck/agent';
import { CORPUS_SOURCES, diffPassages, fetchCorpus, parseDocument, passagesOf, type Passage } from '@doccheck/regulations';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Pool } from 'pg';
import { PG_POOL } from '../../db/db.module';
import { isDemo } from '../../demo/demo-mode';
import type { RegulationChange, RegulationChanges, RegulationCheck } from '../analytics.types';

/** Hours between checks (REG_WATCH_HOURS, default 24; 0 turns them off). */
export const watchHours = () => {
  const h = Number(process.env.REG_WATCH_HOURS ?? 24);
  return Number.isFinite(h) && h > 0 ? h : 0;
};
/** Wait after start before the first scheduled check, so a restart does not hit the sources at once. */
const FIRST_CHECK_DELAY_MS = 5 * 60_000;
const LOCK = 72414;

export interface FetchedDocument {
  id: string;
  title: string;
  url: string;
  effectiveDate?: string;
  body: string;
}

/**
 * Where the corpus is read from: the government pages (default; CBSA and CBP from
 * packages/regulations, Mexico, EU and UK from scripts/corpus-intl.mjs), or REG_WATCH_SOURCE=<directory>
 * of corpus Markdown files laid out like data/corpus (offline servers and tests).
 */
async function readSources(): Promise<{ docs: FetchedDocument[]; errors: { id: string; error: string }[] }> {
  const dir = process.env.REG_WATCH_SOURCE;
  if (dir) {
    const docs: FetchedDocument[] = [];
    for (const sub of (await readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory())) {
      for (const f of (await readdir(join(dir, sub.name))).filter((f) => f.endsWith('.md')).sort()) {
        const d = parseDocument(await readFile(join(dir, sub.name, f), 'utf8'));
        docs.push({ id: d.id, title: d.title, url: d.url, effectiveDate: d.effectiveDate, body: d.body });
      }
    }
    return { docs, errors: [] };
  }
  const docs: FetchedDocument[] = [];
  const errors: { id: string; error: string }[] = [];
  // One source at a time, so one failing page does not lose the others.
  for (const source of CORPUS_SOURCES) {
    try {
      const [fetched] = await fetchCorpus([source]);
      const d = parseDocument(fetched.file);
      docs.push({ id: d.id, title: d.title, url: d.url, effectiveDate: d.effectiveDate, body: d.body });
    } catch (err) {
      errors.push({ id: source.id, error: (err instanceof Error ? err.message : String(err)).slice(0, 300) });
    }
  }
  // Mexico, EU and UK: the sources and converters of scripts/corpus-intl.mjs, when the server has them.
  const intl = [process.cwd(), resolve(__dirname, '../../../../..')].map((d) => join(d, 'scripts/corpus-intl.mjs')).find((f) => existsSync(f));
  if (intl) {
    const mod = (await import(pathToFileURL(intl).href)) as { INTL_SOURCES: IntlSource[]; convertIntl: (s: IntlSource) => Promise<{ markdown: string; url: string; effectiveDate?: string }> };
    for (const source of mod.INTL_SOURCES) {
      try {
        const { markdown, url, effectiveDate } = await mod.convertIntl(source);
        docs.push({ id: source.id, title: source.title, url, effectiveDate, body: markdown });
      } catch (err) {
        // An optional source (a host that is often down) keeps its previous snapshot without an error.
        if (!source.optional) errors.push({ id: source.id, error: (err instanceof Error ? err.message : String(err)).slice(0, 300) });
      }
    }
  }
  return { docs, errors };
}

interface IntlSource {
  id: string;
  title: string;
  optional?: boolean;
}

const normal = (s: string) => s.replace(/…/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

/** Whether a stored citation excerpt quotes this passage (a long enough piece of it, ellipses dropped). */
export function excerptQuotes(excerpt: string, passage: string | undefined): boolean {
  if (!passage) return false;
  const e = normal(excerpt);
  const p = normal(passage);
  if (!e || !p) return false;
  const probe = e.length > 80 ? e.slice(0, 80) : e;
  return p.includes(probe) || (p.length >= 40 && e.includes(p.slice(0, 80)));
}

/**
 * Re-reads the regulation corpus on a schedule, compares each passage's hash with the stored
 * snapshot, and records what was added, removed or changed with the rules that may cite it. The
 * first check of a document only stores its snapshot. The changes are global; each organization sees,
 * per change, its shipments whose open findings come from those rules and whether their citation
 * quotes the changed passage, and each member what is new since they last looked in that organization.
 */
@Injectable()
export class RegulationWatchService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(RegulationWatchService.name);
  private timer?: NodeJS.Timeout;
  private first?: NodeJS.Timeout;
  private running?: Promise<RegulationCheck>;
  /** Replaced in tests. */
  read = readSources;

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  onApplicationBootstrap() {
    const hours = watchHours();
    if (isDemo() || hours === 0 || process.env.NODE_ENV === 'test') return;
    const run = () => void this.check('scheduled').catch((err) => this.logger.warn(`Regulation check failed: ${err instanceof Error ? err.message : String(err)}`));
    this.first = setTimeout(run, FIRST_CHECK_DELAY_MS);
    this.timer = setInterval(run, hours * 3_600_000);
    this.logger.log(`Checking the regulation corpus for changes every ${hours} h`);
  }

  async onApplicationShutdown() {
    clearTimeout(this.first);
    clearInterval(this.timer);
    await this.running?.catch(() => undefined);
  }

  /** One check; concurrent calls (and other API instances, by advisory lock) share or skip it. */
  check(trigger: 'scheduled' | 'manual'): Promise<RegulationCheck> {
    this.running ??= this.doCheck(trigger).finally(() => (this.running = undefined));
    return this.running;
  }

  private async doCheck(trigger: string): Promise<RegulationCheck> {
    const id = randomUUID();
    const client = await this.pool.connect();
    try {
      const { rows: [lock] } = await client.query<{ ok: boolean }>('select pg_try_advisory_lock($1) as ok', [LOCK]);
      if (!lock.ok) throw new Error('Another regulation check is running');
      await client.query('insert into regulation_checks (id, trigger) values ($1, $2)', [id, trigger]);
      const { docs, errors } = await this.read();
      let changes = 0;
      let baseline = true;
      for (const doc of docs) {
        const before = (await client.query('select * from regulation_passages where document_id = $1 order by ordinal', [doc.id])).rows.map(
          (r): Passage & { effective_date: string | null } => ({ documentId: r.document_id, section: r.section, ordinal: r.ordinal, text: r.text, hash: r.hash, effective_date: r.effective_date }),
        );
        const after = passagesOf({ id: doc.id, body: doc.body });
        await client.query('begin');
        try {
          if (before.length > 0) {
            baseline = false;
            const diff = diffPassages(before, after);
            const rules = JSON.stringify(rulesCiting(doc.id));
            for (const c of diff) {
              const b = c.kind === 'added' ? undefined : c.before;
              const a = c.kind === 'removed' ? undefined : c.after;
              await client.query(
                `insert into regulation_changes (id, check_id, document_id, title, url, kind, section, before_text, after_text, before_hash, after_hash, effective_before, effective_after, rules)
                 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
                [randomUUID(), id, doc.id, doc.title, doc.url, c.kind, (a ?? b)!.section, b?.text ?? null, a?.text ?? null, b?.hash ?? null, a?.hash ?? null, before[0].effective_date, doc.effectiveDate ?? null, rules],
              );
            }
            changes += diff.length;
          }
          await client.query('delete from regulation_passages where document_id = $1', [doc.id]);
          for (const p of after) {
            await client.query(
              'insert into regulation_passages (document_id, ordinal, section, text, hash, url, title, effective_date, check_id) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
              [doc.id, p.ordinal, p.section, p.text, p.hash, doc.url, doc.title, doc.effectiveDate ?? null, id],
            );
          }
          await client.query('commit');
        } catch (err) {
          await client.query('rollback');
          throw err;
        }
      }
      const { rows: [row] } = await client.query(
        'update regulation_checks set finished_at = now(), documents = $2, changes = $3, errors = $4, baseline = $5 where id = $1 returning *',
        [id, docs.length, changes, JSON.stringify(errors), baseline && docs.length > 0],
      );
      if (changes) this.logger.log(`Regulation check: ${changes} changed passage(s) in ${docs.length} document(s)`);
      return toCheck(row);
    } catch (err) {
      await client.query(`update regulation_checks set finished_at = now(), errors = $2 where id = $1`, [id, JSON.stringify([{ id: '*', error: err instanceof Error ? err.message : String(err) }])]).catch(() => undefined);
      throw err;
    } finally {
      await client.query('select pg_advisory_unlock($1)', [LOCK]).catch(() => undefined);
      client.release();
    }
  }

  /** The latest changes, with the organization's affected shipments and what this member has not seen. */
  async changes(orgId: string, userId: string, limit = 100): Promise<RegulationChanges> {
    const [checks, changes, read, findings] = await Promise.all([
      this.pool.query('select * from regulation_checks order by started_at desc limit 10'),
      this.pool.query('select * from regulation_changes order by detected_at desc, document_id, section limit $1', [limit]),
      this.pool.query<{ at: Date }>(READ_AT, [orgId, userId]),
      // Open findings of the organization's latest validations: rule, destination and the passage they cite.
      this.pool.query(
        `select s.id as shipment_id, s.reference, lv.destination, f.rule_id, f.regulation
         from shipments s join dc_latest_validations lv on lv.shipment_id = s.id join findings f on f.validation_id = lv.validation_id
         left join finding_status fs on fs.shipment_id = f.shipment_id and fs.fingerprint = f.fingerprint
         where s.org_id = $1 and coalesce(fs.status, 'open') in ('open', 'waiting_supplier')`,
        [orgId],
      ),
    ]);
    const readAt = read.rows[0]?.at ?? new Date(0);
    const items: RegulationChange[] = changes.rows.map((r) => {
      const rules = r.rules as { destination: string; ruleId: string }[];
      const affected = new Map<string, RegulationChange['affected'][number]>();
      for (const f of findings.rows) {
        if (!rules.some((x) => x.ruleId === f.rule_id && x.destination === f.destination)) continue;
        const cites = !!f.regulation?.url && f.regulation.url === r.url && excerptQuotes(f.regulation.excerpt ?? '', r.before_text ?? r.after_text);
        const a: RegulationChange['affected'][number] = affected.get(f.shipment_id) ?? { shipmentId: f.shipment_id, ...(f.reference ? { reference: f.reference } : {}), ruleIds: [] as string[], citesPassage: false };
        if (!a.ruleIds.includes(f.rule_id)) a.ruleIds.push(f.rule_id);
        a.citesPassage ||= cites;
        affected.set(f.shipment_id, a);
      }
      return {
        id: r.id,
        checkId: r.check_id,
        documentId: r.document_id,
        title: r.title,
        url: r.url,
        kind: r.kind,
        section: r.section,
        ...(r.before_text !== null ? { before: r.before_text } : {}),
        ...(r.after_text !== null ? { after: r.after_text } : {}),
        ...(r.effective_before ? { effectiveBefore: r.effective_before } : {}),
        ...(r.effective_after ? { effectiveAfter: r.effective_after } : {}),
        rules,
        detectedAt: (r.detected_at as Date).toISOString(),
        unread: (r.detected_at as Date) > readAt,
        affected: [...affected.values()].sort((a, b) => Number(b.citesPassage) - Number(a.citesPassage) || (a.reference ?? '').localeCompare(b.reference ?? '')),
      };
    });
    return { checks: checks.rows.map(toCheck), changes: items, unread: items.filter((c) => c.unread).length, intervalHours: isDemo() ? 0 : watchHours() };
  }

  async unread(orgId: string, userId: string): Promise<number> {
    const { rows: [r] } = await this.pool.query<{ n: number }>(`select count(*)::int as n from regulation_changes where detected_at > (${READ_AT})`, [orgId, userId]);
    return r.n;
  }

  async markRead(orgId: string, userId: string): Promise<void> {
    await this.pool.query(
      'insert into regulation_reads (org_id, user_id, read_at) values ($1, $2, now()) on conflict (org_id, user_id) do update set read_at = now()',
      [orgId, userId],
    );
  }
}

/** When the member ($2) last opened the changes in the organization ($1); before that, when they joined it. */
const READ_AT = `select coalesce(
  (select read_at from regulation_reads where org_id = $1 and user_id = $2),
  (select created_at from org_members where org_id = $1 and user_id = $2),
  now()) as at`;

const toCheck = (r: Record<string, unknown>): RegulationCheck => ({
  id: r.id as string,
  startedAt: (r.started_at as Date).toISOString(),
  ...(r.finished_at ? { finishedAt: (r.finished_at as Date).toISOString() } : {}),
  trigger: r.trigger as string,
  documents: r.documents as number,
  changes: r.changes as number,
  errors: r.errors as { id: string; error: string }[],
  baseline: r.baseline as boolean,
});
