import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { isDemo } from '../demo/demo-mode';
import { MAX_ATTEMPTS, retryDelayMs, UNASSIGNED_RETENTION_DAYS } from './mail.config';
import { MailRepository } from './mail.repository';
import { MailTransport } from './mail-transport';

/**
 * Sends queued messages from the database (an outbox): a message is stored first, then sent, so a
 * crash or an SMTP outage never loses it. Failures retry after 1, 2, 4 and 8 minutes, then the message
 * is failed (the user can retry it). Several API processes can run this: rows are claimed with
 * SKIP LOCKED.
 */
@Injectable()
export class OutboxWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxWorker.name);
  private timer?: NodeJS.Timeout;
  private pruner?: NodeJS.Timeout;
  private running?: Promise<void>;

  constructor(
    private readonly repo: MailRepository,
    private readonly transport: MailTransport,
  ) {}

  onApplicationBootstrap() {
    if (isDemo() || process.env.MAIL_OUTBOX === 'off') return;
    const every = Math.max(500, Number(process.env.MAIL_OUTBOX_MS ?? 3000) || 3000);
    void this.repo.recoverStuck().then((n) => n && this.logger.warn(`${n} message(s) left sending by a previous process were queued again`));
    this.timer = setInterval(() => this.kick(), every);
    // Received mail nobody claimed does not pile up forever.
    const prune = () => void this.repo.pruneUnassigned(UNASSIGNED_RETENTION_DAYS).then((n) => n && this.logger.log(`Deleted ${n} unassigned message(s) older than ${UNASSIGNED_RETENTION_DAYS} days`)).catch(() => undefined);
    prune();
    this.pruner = setInterval(prune, 6 * 3600_000);
  }

  async onApplicationShutdown() {
    clearInterval(this.timer);
    clearInterval(this.pruner);
    await this.running;
  }

  /** Sends what is due now (one run at a time); called on a timer and right after queueing. */
  kick(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.drain()
      .catch((err) => this.logger.error(`Outbox: ${err instanceof Error ? err.message : err}`))
      .finally(() => (this.running = undefined));
    return this.running;
  }

  private async drain() {
    for (;;) {
      const batch = await this.repo.claimOutbox(5);
      if (batch.length === 0) return;
      for (const item of batch) {
        try {
          await this.repo.markSent(item.id, await this.transport.send(item));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const retry = item.attempts < MAX_ATTEMPTS ? new Date(Date.now() + retryDelayMs(item.attempts)) : null;
          await this.repo.markRetry(item.id, message, retry);
          this.logger.warn(`Sending ${item.id} failed (attempt ${item.attempts}): ${message}${retry ? '; retrying' : '; giving up'}`);
        }
      }
    }
  }
}
