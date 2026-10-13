import { Injectable, Logger, type BeforeApplicationShutdown, type OnApplicationBootstrap } from '@nestjs/common';
import type { NewProgressEvent, ProgressEvent, ProgressKind } from '@doccheck/schemas';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { Observable, Subject } from 'rxjs';
import { demoPacing } from './demo-pacing';
import { ProgressRun } from './progress-run';
import { PROGRESS_CHANNEL, ProgressRepository } from './progress.repository';
import { parseNotification } from './sse';

/** NOTIFY payloads must be shorter than 8000 bytes; larger events are announced by id. */
const NOTIFY_MAX_BYTES = 7900;
/** Delay before reconnecting the LISTEN client, doubled up to the max on repeated failures. */
const RECONNECT_MS = 1000;
const RECONNECT_MAX_MS = 30_000;
const PRUNE_EVERY_MS = 60 * 60 * 1000;
/** Ids remembered to drop an event delivered twice (a notification racing a backfill). */
const SEEN_IDS = 2000;

/**
 * Publishes progress events and delivers them live to every API process.
 *
 * publish(): stores the event (progress_events) and NOTIFYs channel doccheck_progress, one event at a
 * time per process so ids follow the order of the calls. Never throws: progress must not break the
 * work it describes.
 * events: every process LISTENs on a dedicated connection (the extraction worker may be another
 * process) and fans the events out in memory; SSE handlers subscribe and filter. The connection is
 * re-opened on error, and what was stored meanwhile is read back from the table.
 */
@Injectable()
export class ProgressService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(ProgressService.name);
  private readonly subject = new Subject<ProgressEvent>();
  private tail: Promise<unknown> = Promise.resolve();
  private listener?: Client;
  private reconnectMs = RECONNECT_MS;
  private reconnectTimer?: NodeJS.Timeout;
  private pruneTimer?: NodeJS.Timeout;
  private closing = false;
  /** Highest id delivered, to backfill after a reconnect. */
  private lastId = 0;
  private readonly seen = new Set<number>();
  private readonly paced = demoPacing();

  constructor(private readonly repo: ProgressRepository) {}

  /** Live events of all users; completes when the app shuts down. Subscribers filter what they need. */
  get events(): Observable<ProgressEvent> {
    return this.subject.asObservable();
  }

  /** Stores and announces an event. Resolves with the stored event, or null if it could not be stored. */
  publish(event: NewProgressEvent): Promise<ProgressEvent | null> {
    const next = this.tail.then(() =>
      this.repo.insert(event, NOTIFY_MAX_BYTES).catch((err: Error) => {
        this.logger.warn(`Progress event ${event.kind}/${event.stage}/${event.status} not stored: ${err.message}`);
        return null;
      }),
    );
    this.tail = next;
    return next;
  }

  /** Waits until every event published so far is stored (tests, and before answering a blocking call). */
  flush(): Promise<void> {
    return this.tail.then(() => undefined);
  }

  /** A run to report on: an extraction of a document or a validation. `runId` defaults to a new id. */
  run<K extends ProgressKind>(kind: K, shipmentId: string, opts: { documentId?: string; runId?: string } = {}): ProgressRun<K> {
    return new ProgressRun({ kind, shipmentId, documentId: opts.documentId, runId: opts.runId ?? randomUUID() }, (e) => this.publish(e), this.paced);
  }

  /** After migrations ran: listen, prune old events, then prune every hour. */
  async onApplicationBootstrap() {
    await this.listen();
    void this.prune();
    this.pruneTimer = setInterval(() => void this.prune(), PRUNE_EVERY_MS);
    this.pruneTimer.unref();
  }

  /** Before the HTTP server closes: open SSE responses end, or they would keep it from closing. */
  async beforeApplicationShutdown() {
    this.closing = true;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.pruneTimer);
    this.subject.complete();
    await this.flush();
    await this.listener?.end().catch(() => undefined);
  }

  private async prune() {
    const days = Number(process.env.PROGRESS_RETENTION_DAYS ?? 7);
    try {
      const n = await this.repo.prune(days);
      if (n) this.logger.log(`Pruned ${n} progress event(s) older than ${days} days`);
    } catch (err) {
      this.logger.warn(`Pruning progress events failed: ${(err as Error).message}`);
    }
  }

  private async listen(): Promise<void> {
    if (this.closing) return;
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    this.listener = client;
    let dropped = false;
    const drop = (err?: Error) => {
      if (dropped) return;
      dropped = true;
      if (err) this.logger.warn(`Progress listener lost its connection (${err.message}); reconnecting`);
      client.removeAllListeners('notification');
      void client.end().catch(() => undefined);
      this.scheduleReconnect();
    };
    client.on('error', drop);
    client.on('end', () => drop());
    client.on('notification', (msg) => {
      if (msg.channel === PROGRESS_CHANNEL && msg.payload) void this.receive(msg.payload);
    });
    try {
      await client.connect();
      await client.query(`listen ${PROGRESS_CHANNEL}`);
      this.reconnectMs = RECONNECT_MS;
      // First connection: start from now. After a reconnect: deliver what was stored meanwhile.
      if (this.lastId === 0) this.lastId = await this.repo.lastId().catch(() => 0);
      else for (const e of await this.repo.listAfter(this.lastId)) this.deliver(e);
    } catch (err) {
      drop(err as Error);
    }
  }

  private scheduleReconnect() {
    if (this.closing) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => void this.listen(), this.reconnectMs);
    this.reconnectTimer.unref();
    this.reconnectMs = Math.min(this.reconnectMs * 2, RECONNECT_MAX_MS);
  }

  private async receive(payload: string) {
    const parsed = parseNotification(payload);
    if (!parsed) return;
    const event = 'kind' in parsed ? parsed : await this.repo.find(parsed.id).catch(() => null);
    if (event) this.deliver(event);
  }

  private deliver(event: ProgressEvent) {
    if (this.closing || this.seen.has(event.id)) return;
    this.seen.add(event.id);
    if (this.seen.size > SEEN_IDS) this.seen.delete(this.seen.values().next().value as number);
    this.lastId = Math.max(this.lastId, event.id);
    this.subject.next(event);
  }
}
