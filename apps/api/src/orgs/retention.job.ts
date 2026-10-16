import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import type { Pool } from 'pg';
import { AuditService, type AuditActor } from '../audit/audit.service';
import { PG_POOL } from '../db/db.module';
import { isDemo } from '../demo/demo-mode';
import { ShipmentsService } from '../shipments/shipments.service';

/**
 * Shipments past their organization's retention period, oldest first. The period runs from when the
 * shipment was created, per destination: retention_ca_years for Canada, retention_us_years for the US,
 * retention_mx_years, retention_eu_years and retention_gb_years for Mexico, the EU and the UK, and the
 * longest of them while the destination is not set. Expired is strictly older: a shipment on
 * its last day is kept.
 */
const EXPIRED = `
  select s.id, s.org_id, s.reference, s.destination, s.created_at, (select count(*)::int from documents d where d.shipment_id = s.id) as documents
  from shipments s join organizations o on o.id = s.org_id
  where ($1::uuid is null or s.org_id = $1)
    and s.created_at < now() - make_interval(years => case s.destination
      when 'CA' then o.retention_ca_years when 'US' then o.retention_us_years
      when 'MX' then o.retention_mx_years when 'EU' then o.retention_eu_years when 'GB' then o.retention_gb_years
      else greatest(o.retention_ca_years, o.retention_us_years, o.retention_mx_years, o.retention_eu_years, o.retention_gb_years) end)
  order by s.created_at limit $2`;

export interface RetentionResult {
  deleted: number;
  skipped: number;
}

/**
 * Deletes what has outlived the records retention period (CBSA 6 years, CBP 5, Mexico 5, EU 3, UK 4 by
 * default, set per organization) once a day, and nothing else. Each deletion goes to the audit log with what was
 * deleted; a shipment still extracting is left for the next run.
 */
@Injectable()
export class RetentionJob implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(RetentionJob.name);
  private timer?: NodeJS.Timeout;
  private first?: NodeJS.Timeout;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly shipments: ShipmentsService,
    private readonly audit: AuditService,
  ) {}

  onApplicationBootstrap() {
    if (isDemo() || process.env.RETENTION_JOB === 'off') return;
    const every = Math.max(60_000, Number(process.env.RETENTION_INTERVAL_MS ?? 24 * 3600_000) || 24 * 3600_000);
    const tick = () => void this.run().catch((err) => this.logger.error(`Retention: ${err instanceof Error ? err.message : err}`));
    this.first = setTimeout(tick, 60_000);
    this.timer = setInterval(tick, every);
  }

  onApplicationShutdown() {
    clearTimeout(this.first);
    clearInterval(this.timer);
  }

  /** What a run would delete now in one organization (the settings page shows it before saving). */
  async preview(orgId: string): Promise<{ expired: number }> {
    const { rows } = await this.pool.query(`select count(*)::int as n from (${EXPIRED}) x`, [orgId, 100_000]);
    return { expired: rows[0].n };
  }

  /** Deletes expired shipments of one organization, or of all (the daily run). */
  async run(orgId: string | null = null, actor: AuditActor = { email: 'system:retention' }): Promise<RetentionResult> {
    const result: RetentionResult = { deleted: 0, skipped: 0 };
    const { rows } = await this.pool.query(EXPIRED, [orgId, 1000]);
    for (const r of rows) {
      try {
        await this.shipments.remove(r.id);
        result.deleted++;
        await this.audit.record(actor, {
          orgId: r.org_id,
          action: 'retention.delete',
          entity: 'shipment',
          entityId: r.id,
          before: { reference: r.reference, destination: r.destination, createdAt: new Date(r.created_at).toISOString(), documents: r.documents },
        });
      } catch (err) {
        result.skipped++;
        this.logger.warn(`Retention: shipment ${r.id} kept for now: ${err instanceof Error ? err.message : err}`);
      }
    }
    if (result.deleted) this.logger.log(`Retention: deleted ${result.deleted} expired shipment(s)`);
    return result;
  }
}
