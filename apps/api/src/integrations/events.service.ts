import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { type EventData, type EventType, type ShipmentRef, type WebhookEvent } from '@doccheck/integrations';
import type { ProgressEvent, Severity } from '@doccheck/schemas';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { Subscription } from 'rxjs';
import { appUrl } from '../auth/app-url';
import { PG_POOL } from '../db/db.module';
import { isDemo } from '../demo/demo-mode';
import { ProgressService } from '../progress/progress.service';
import { FindingReviewsRepository } from '../shipments/reviews.repository';
import { ShipmentsRepository } from '../shipments/shipments.repository';
import { DeliveryWorker } from './deliveries';
import { TrackingService } from './tracking.service';

const REPLY_POLL_MS = 15_000;

export const shipmentUrl = (id: string) => `${appUrl() ?? ''}/#/app/s/${id}`;
export const threadUrl = (id: string) => `${appUrl() ?? ''}/#/app/inbox/${id}`;

/**
 * Turns what happens in DocCheck into integration events and hands each one to the account's
 * webhooks and chat alerts.
 *
 * Sources: progress events (every API process hears all of them over LISTEN/NOTIFY) for
 * document.extracted, validation.completed and the findings a validation created or resolved; a
 * poll of received mail for supplier.replied. Each event is stored once under a unique dedupe key,
 * and only the process whose insert won delivers it, so several processes never send it twice.
 */
@Injectable()
export class IntegrationEventsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(IntegrationEventsService.name);
  private sub?: Subscription;
  private timer?: NodeJS.Timeout;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly progress: ProgressService,
    private readonly shipments: ShipmentsRepository,
    private readonly reviews: FindingReviewsRepository,
    private readonly deliveries: DeliveryWorker,
    private readonly tracking: TrackingService,
  ) {}

  onApplicationBootstrap() {
    if (isDemo()) return;
    // One event at a time, in order: a validation's findings are compared after its document events.
    this.sub = this.progress.events.subscribe((e) => {
      this.tail = this.tail.then(() => this.onProgress(e)).catch((err: Error) => this.logger.warn(`Integration event from ${e.kind}/${e.stage} failed: ${err.message}`));
    });
    this.timer = setInterval(() => void this.pollReplies(), Number(process.env.INTEGRATION_REPLY_POLL_MS ?? REPLY_POLL_MS) || REPLY_POLL_MS);
    this.timer.unref();
  }

  async onApplicationShutdown() {
    this.sub?.unsubscribe();
    clearInterval(this.timer);
    await this.tail;
  }

  private async onProgress(e: ProgressEvent) {
    if (e.ephemeral || e.stage !== 'saved' || e.status !== 'done' || !e.userId) return;
    if (e.kind === 'extraction' && e.documentId) await this.documentExtracted(e.userId, e.shipmentId, e.documentId, e.runId);
    if (e.kind === 'validation') await this.validationCompleted(e.userId, e.shipmentId, e.runId);
  }

  private async shipmentRef(id: string): Promise<ShipmentRef> {
    const { rows } = await this.pool.query<{ reference: string | null }>('select reference from shipments where id = $1', [id]);
    return { id, reference: rows[0]?.reference ?? null, url: shipmentUrl(id) };
  }

  private async documentExtracted(accountId: string, shipmentId: string, documentId: string, runId: string) {
    const doc = await this.shipments.findDocument(documentId);
    if (!doc) return;
    const ext = await this.shipments.findExtraction(shipmentId, documentId);
    await this.emit(accountId, 'document.extracted', `document.extracted:${runId}`, shipmentId, {
      shipment: await this.shipmentRef(shipmentId),
      document: { id: documentId, fileName: doc.fileName, type: doc.detectedType, normalized: !!ext?.data, pages: doc.pageCount || null },
    });
  }

  /**
   * After a validation is stored: container tracking adds its findings (when the account turned it
   * on), then validation.completed and one finding.created / finding.resolved per finding that is
   * new since the previous run or gone from it.
   */
  private async validationCompleted(accountId: string, shipmentId: string, validationId: string) {
    const claim = await this.claim(accountId, 'validation.completed', `validation.completed:${validationId}`, shipmentId);
    if (!claim) return;
    await this.tracking.afterValidation(accountId, shipmentId, validationId).catch((err: Error) => this.logger.warn(`Container tracking for ${shipmentId} failed: ${err.message}`));
    const shipment = await this.shipmentRef(shipmentId);
    const [validation, findings, previous] = await Promise.all([
      this.shipments.findValidation(shipmentId, validationId),
      this.shipments.validationFindings(validationId),
      this.reviews.previousValidation(shipmentId, validationId),
    ]);
    const bySeverity: Partial<Record<Severity, number>> = {};
    for (const f of findings) bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
    await this.complete(claim, 'validation.completed', {
      shipment,
      validation: { id: validationId, findings: findings.length, skipped: validation?.skipped.length ?? 0, bySeverity },
    });
    const before = previous ? await this.shipments.validationFindings(previous.id) : [];
    const earlier = new Set(before.map((f) => f.fingerprint));
    const now = new Set(findings.map((f) => f.fingerprint));
    const ref = (f: (typeof findings)[number]) => ({ fingerprint: f.fingerprint, ruleId: f.ruleId, severity: f.severity, message: f.message });
    for (const f of findings.filter((f) => !earlier.has(f.fingerprint))) {
      await this.emit(accountId, 'finding.created', `finding.created:${validationId}:${f.fingerprint}`, shipmentId, { shipment, validationId, finding: ref(f) });
    }
    for (const f of before.filter((f) => !now.has(f.fingerprint))) {
      await this.emit(accountId, 'finding.resolved', `finding.resolved:${validationId}:${f.fingerprint}`, shipmentId, { shipment, validationId, finding: ref(f) });
    }
  }

  /** supplier.replied for mail received in a conversation since the last poll. */
  async pollReplies() {
    try {
      await this.pool.query(`insert into integration_cursors (name, position) values ('supplier.replied', now()) on conflict do nothing`);
      const { rows } = await this.pool.query(
        `select m.id, m.from_addr, m.received_at, m.created_at, t.id as thread_id, t.subject, t.user_id, t.shipment_id,
                (select count(*)::int from mail_attachments a where a.message_id = m.id) as attachments
         from mail_messages m join mail_threads t on t.id = m.thread_id
         where m.direction = 'in' and t.kind <> 'intake'
           and m.created_at > (select position from integration_cursors where name = 'supplier.replied')
         order by m.created_at limit 200`,
      );
      for (const r of rows) {
        await this.emit(r.user_id, 'supplier.replied', `supplier.replied:${r.id}`, r.shipment_id, {
          shipment: r.shipment_id ? await this.shipmentRef(r.shipment_id) : null,
          thread: { id: r.thread_id, subject: r.subject, url: threadUrl(r.thread_id) },
          message: { id: r.id, from: r.from_addr, receivedAt: new Date(r.received_at ?? r.created_at).toISOString(), attachments: r.attachments },
        });
      }
      if (rows.length) await this.pool.query(`update integration_cursors set position = greatest(position, $1) where name = 'supplier.replied'`, [rows.at(-1)!.created_at]);
    } catch (err) {
      this.logger.warn(`Polling supplier replies failed: ${(err as Error).message}`);
    }
  }

  /** Stores an event once and delivers it; nothing when another process already did. */
  async emit<T extends EventType>(accountId: string, type: T, dedupeKey: string, shipmentId: string | null, data: EventData[T]) {
    const claim = await this.claim(accountId, type, dedupeKey, shipmentId);
    if (claim) await this.complete(claim, type, data);
  }

  private async claim(accountId: string, type: EventType, dedupeKey: string, shipmentId: string | null): Promise<{ id: string; accountId: string; createdAt: string } | null> {
    const id = randomUUID();
    const { rows } = await this.pool.query(
      `insert into integration_events (id, account_id, type, shipment_id, dedupe_key, payload) values ($1, $2, $3, $4, $5, '{}') on conflict (dedupe_key) do nothing returning created_at`,
      [id, accountId, type, shipmentId, dedupeKey],
    );
    return rows[0] ? { id, accountId, createdAt: new Date(rows[0].created_at).toISOString() } : null;
  }

  private async complete<T extends EventType>(claim: { id: string; accountId: string; createdAt: string }, type: T, data: EventData[T]) {
    const event: WebhookEvent<T> = { id: claim.id, type, createdAt: claim.createdAt, data };
    await this.pool.query('update integration_events set payload = $2 where id = $1', [claim.id, JSON.stringify(event)]);
    const targets = await this.pool.query<{ type: 'webhook' | 'chat'; id: string }>(
      `select 'webhook' as type, id from webhook_subscriptions where account_id = $1 and active and $2 = any(events)
       union all select 'chat', id from chat_alerts where account_id = $1 and active and $2 = any(events)`,
      [claim.accountId, type],
    );
    for (const t of targets.rows) await this.deliveries.create(claim.accountId, t.type, t.id, event, { eventId: claim.id });
  }
}
