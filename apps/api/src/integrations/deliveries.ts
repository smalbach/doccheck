import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { chatBody, signPayload, SIGNATURE_HEADER, type ChatKind, type WebhookEvent } from '@doccheck/integrations';
import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { isDemo } from '../demo/demo-mode';
import { open, type Sealed } from '../messaging/secret-box';
import { safeRequest } from './safe-fetch';
import { redisUrl } from '../redis-url';

const QUEUE = 'integration-deliveries';
/** Attempts per delivery, and the delay before the second one (doubled each time): 30 s, 1, 2, 4, 8, 16 min. */
const maxAttempts = () => Math.max(1, Number(process.env.WEBHOOK_MAX_ATTEMPTS ?? 7) || 7);
const backoffMs = () => Math.max(10, Number(process.env.WEBHOOK_BACKOFF_MS ?? 30_000) || 30_000);
const delayAfter = (attempt: number) => backoffMs() * 2 ** (attempt - 1);
const POLL_MS = 2000;

export type TargetType = 'webhook' | 'chat';

export interface DeliveryView {
  id: string;
  targetType: TargetType;
  targetId: string;
  eventId: string | null;
  eventType: string;
  status: 'pending' | 'succeeded' | 'failed';
  attempts: number;
  responseStatus: number | null;
  responseBody: string | null;
  error: string | null;
  durationMs: number | null;
  nextAttemptAt: string | null;
  redeliveryOf: string | null;
  createdAt: string;
  deliveredAt: string | null;
  payload?: unknown;
}

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
export const toDeliveryView = (r: Record<string, unknown>, withPayload = false): DeliveryView => ({
  id: r.id as string,
  targetType: r.target_type as TargetType,
  targetId: r.target_id as string,
  eventId: (r.event_id as string) ?? null,
  eventType: r.event_type as string,
  status: r.status as DeliveryView['status'],
  attempts: r.attempts as number,
  responseStatus: (r.response_status as number) ?? null,
  responseBody: (r.response_body as string) ?? null,
  error: (r.error as string) ?? null,
  durationMs: (r.duration_ms as number) ?? null,
  nextAttemptAt: iso(r.next_attempt_at),
  redeliveryOf: (r.redelivery_of as string) ?? null,
  createdAt: iso(r.created_at)!,
  deliveredAt: iso(r.delivered_at),
  ...(withPayload ? { payload: r.payload } : {}),
});

function redisConnection(url: string): ConnectionOptions {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: u.pathname.length > 1 ? Number(u.pathname.slice(1)) : 0,
    maxRetriesPerRequest: null,
  };
}

/**
 * Sends webhook and chat-alert deliveries and records every attempt. With REDIS_URL each delivery is
 * a BullMQ job retried with exponential backoff; without Redis a poller in this process picks due
 * deliveries from the table (next_attempt_at), with the same backoff, claiming them with
 * `for update skip locked` so several processes never send one twice.
 */
@Injectable()
export class DeliveryWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(DeliveryWorker.name);
  private queue?: Queue;
  private worker?: Worker;
  private timer?: NodeJS.Timeout;
  private polling?: Promise<void>;

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  get mode(): 'bullmq' | 'poller' {
    return this.queue ? 'bullmq' : 'poller';
  }

  async onApplicationBootstrap() {
    if (isDemo()) return;
    const url = redisUrl();
    if (url) {
      const connection = redisConnection(url);
      this.queue = new Queue(QUEUE, { connection, prefix: 'doccheck' });
      this.worker = new Worker<{ deliveryId: string }>(QUEUE, async (job) => this.attempt(job.data.deliveryId, job.attemptsMade + 1 >= (job.opts.attempts ?? 1)), {
        connection,
        prefix: 'doccheck',
        concurrency: 5,
        settings: { backoffStrategy: (attemptsMade: number) => delayAfter(attemptsMade) },
      });
      this.worker.on('failed', (job, err) => this.logger.debug(`Delivery ${job?.data.deliveryId} attempt ${job?.attemptsMade}: ${err.message}`));
      return;
    }
    this.timer = setInterval(() => void this.poll(), Number(process.env.WEBHOOK_POLL_MS ?? POLL_MS) || POLL_MS);
    this.timer.unref();
  }

  async onApplicationShutdown() {
    clearInterval(this.timer);
    await this.polling;
    await this.worker?.close();
    await this.queue?.close();
  }

  /** Creates a delivery and sends it as soon as possible. `eventId` null for a test send. Returns its id, or null when it already existed. */
  async create(orgId: string, targetType: TargetType, targetId: string, event: WebhookEvent, opts: { eventId?: string | null; redeliveryOf?: string } = {}): Promise<string | null> {
    const id = randomUUID();
    const { rowCount } = await this.pool.query(
      `insert into integration_deliveries (id, org_id, target_type, target_id, event_id, event_type, payload, next_attempt_at, redelivery_of)
       values ($1, $2, $3, $4, $5, $6, $7, now(), $8) on conflict do nothing`,
      [id, orgId, targetType, targetId, opts.eventId ?? null, event.type, JSON.stringify(event), opts.redeliveryOf ?? null],
    );
    if (!rowCount) return null;
    await this.enqueue(id);
    return id;
  }

  private async enqueue(id: string) {
    if (this.queue) {
      await this.queue.add('deliver', { deliveryId: id }, { jobId: id, attempts: maxAttempts(), backoff: { type: 'custom' }, removeOnComplete: 1000, removeOnFail: 5000 });
    } else if (!isDemo()) {
      void this.poll();
    }
  }

  /** Poller mode: due deliveries, claimed one at a time. */
  private poll(): Promise<void> {
    if (this.polling) return this.polling;
    this.polling = (async () => {
      try {
        for (let i = 0; i < 50; i++) {
          const client = await this.pool.connect();
          let id: string | undefined;
          try {
            await client.query('begin');
            const { rows } = await client.query<{ id: string; attempts: number }>(
              `select id, attempts from integration_deliveries where status = 'pending' and next_attempt_at <= now() order by next_attempt_at limit 1 for update skip locked`,
            );
            id = rows[0]?.id;
            // Pushed back while it is sent, so another poller does not pick it up meanwhile.
            if (id) await client.query(`update integration_deliveries set next_attempt_at = now() + interval '1 minute' where id = $1`, [id]);
            await client.query('commit');
            if (!id) return;
            const last = rows[0]!.attempts + 1 >= maxAttempts();
            await this.attempt(id, last).catch(() => undefined);
          } catch (err) {
            await client.query('rollback').catch(() => undefined);
            this.logger.warn(`Delivery poll failed: ${(err as Error).message}`);
            return;
          } finally {
            client.release();
          }
        }
      } finally {
        this.polling = undefined;
      }
    })();
    return this.polling;
  }

  /**
   * One attempt: send, record the outcome, and either finish the delivery or schedule the next try.
   * Throws when the attempt failed (BullMQ then retries); `last` says no retry follows.
   */
  async attempt(deliveryId: string, last: boolean): Promise<void> {
    const { rows } = await this.pool.query('select * from integration_deliveries where id = $1', [deliveryId]);
    const d = rows[0];
    if (!d || d.status !== 'pending') return;
    const target = await this.target(d);
    const started = Date.now();
    let status: number | null = null;
    let body: string | null = null;
    let error: string | null = null;
    if (!target) {
      error = 'The webhook or alert was deleted or turned off';
    } else {
      try {
        const res = await safeRequest(target.url, { method: 'POST', headers: target.headers, body: target.body, timeoutMs: 10_000, maxBytes: 2048 });
        status = res.status;
        body = res.body.slice(0, 1000);
        if (status < 200 || status >= 300) error = `Answered ${status}`;
      } catch (err) {
        error = (err as Error).message.slice(0, 500);
      }
    }
    const ok = error === null;
    const final = ok || last || !target;
    await this.pool.query(
      `update integration_deliveries set attempts = attempts + 1, response_status = $2, response_body = $3, error = $4, duration_ms = $5,
         status = $6, delivered_at = case when $6 = 'succeeded' then now() else delivered_at end,
         next_attempt_at = case when $6 = 'pending' then now() + ($7::int * interval '1 millisecond') else null end
       where id = $1`,
      [deliveryId, status, body, error, Date.now() - started, ok ? 'succeeded' : final ? 'failed' : 'pending', delayAfter(d.attempts + 1)],
    );
    if (!ok && !final) throw new Error(error!);
  }

  /** Where and what to send: the signed JSON for a webhook, a Slack or Teams message for a chat alert. Null when the target is gone or off. */
  private async target(d: { id: string; target_type: TargetType; target_id: string; payload: WebhookEvent }): Promise<{ url: string; headers: Record<string, string>; body: string } | null> {
    if (d.target_type === 'webhook') {
      const { rows } = await this.pool.query('select url, secret, active from webhook_subscriptions where id = $1', [d.target_id]);
      const w = rows[0];
      const secret = w?.active ? open(w.secret as Sealed) : undefined;
      if (!secret) return null;
      // The stored event as it was first sent; a redelivery keeps the event id, so receivers can drop duplicates.
      const body = JSON.stringify(d.payload);
      return {
        url: w.url,
        body,
        headers: { 'content-type': 'application/json', [SIGNATURE_HEADER]: signPayload(secret, body), 'DocCheck-Event': d.payload.type, 'DocCheck-Delivery': d.id },
      };
    }
    const { rows } = await this.pool.query('select kind, url, include_details, active from chat_alerts where id = $1', [d.target_id]);
    const c = rows[0];
    const url = c?.active ? open(c.url as Sealed) : undefined;
    if (!url) return null;
    return { url, headers: { 'content-type': 'application/json' }, body: JSON.stringify(chatBody(c.kind as ChatKind, d.payload, { includeDetails: c.include_details })) };
  }
}
