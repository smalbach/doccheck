import { Inject, Injectable, Logger } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';

/** One audit row before it is chained (migration 040). */
export interface AuditEntry {
  action: string;
  entity?: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
}

export interface AuditActor {
  orgId?: string | null;
  userId?: string | null;
  email?: string | null;
  ip?: string | null;
}

/** What a request collects while it runs; AuditInterceptor writes it when the request succeeds. */
export interface AuditScope {
  actor: AuditActor;
  entries: (AuditEntry & { orgId?: string | null })[];
}

const KEY_REDACTED = /password|secret|token|code|ticket/i;
const MAX_JSON = 16_000;

/** A copy safe to store: secrets replaced, long values cut, so the log never holds a password or a code. */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (depth > 6) return '…';
  if (typeof value === 'string') return value.length > 2000 ? `${value.slice(0, 2000)}…` : value;
  if (typeof value !== 'object') return value;
  if (Buffer.isBuffer(value)) return `<${value.length} bytes>`;
  if (Array.isArray(value)) return value.slice(0, 200).map((v) => redact(v, depth + 1));
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, KEY_REDACTED.test(k) ? '[redacted]' : redact(v, depth + 1)]));
}

const json = (value: unknown) => {
  if (value === undefined) return null;
  const text = JSON.stringify(redact(value));
  return text.length > MAX_JSON ? JSON.stringify({ truncated: true, size: text.length }) : text;
};

/**
 * The audit log: every write, append-only and hash-chained per organization (the database refuses
 * updates and deletes). Services add what they changed, with the values before and after, through
 * note(); a write that notes nothing is still logged by AuditInterceptor with its route and body.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  private readonly als = new AsyncLocalStorage<AuditScope>();

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  run<T>(scope: AuditScope, fn: () => T): T {
    return this.als.run(scope, fn);
  }

  scope(): AuditScope | undefined {
    return this.als.getStore();
  }

  /** Adds a change to the current request's log (written when the request succeeds), or writes it at once outside a request. */
  note(entry: AuditEntry & { orgId?: string | null }): void {
    const scope = this.als.getStore();
    if (scope) scope.entries.push(entry);
    else void this.record({}, entry);
  }

  /** Who the request acts as, when a route signs someone in (no session yet when it started). */
  setActor(actor: AuditActor): void {
    const scope = this.als.getStore();
    if (scope) Object.assign(scope.actor, Object.fromEntries(Object.entries(actor).filter(([, v]) => v !== undefined)));
  }

  /** Writes one row now. Failing to audit is logged loudly but never undoes the change. */
  async record(actor: AuditActor, entry: AuditEntry & { orgId?: string | null }): Promise<void> {
    try {
      await this.pool.query(
        `insert into audit_log (org_id, user_id, user_email, action, entity, entity_id, before, after, ip, prev_hash, hash)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, '', '')`,
        [
          entry.orgId !== undefined ? entry.orgId : (actor.orgId ?? null),
          actor.userId ?? null,
          actor.email ?? null,
          entry.action,
          entry.entity ?? null,
          entry.entityId ?? null,
          json(entry.before),
          json(entry.after),
          actor.ip ?? null,
        ],
      );
    } catch (err) {
      this.logger.error(`Audit row "${entry.action}" not written: ${err instanceof Error ? err.message : err}`);
    }
  }
}
