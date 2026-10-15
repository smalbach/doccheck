import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { ImapFlow } from 'imapflow';
import { isDemo } from '../demo/demo-mode';
import { imapPollMs, MAX_MESSAGE_BYTES } from './mail.config';
import { MailInbox } from './mail-inbox';
import { MailRepository } from './mail.repository';

/**
 * Reads new mail from IMAP_URL (imaps://user:password@host:993) every IMAP_POLL_MS, from IMAP_MAILBOX
 * (INBOX). It remembers the last UID it read; on the first run it starts from the newest message,
 * so an existing mailbox is not imported.
 */
@Injectable()
export class ImapPoller implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ImapPoller.name);
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;

  constructor(
    private readonly repo: MailRepository,
    private readonly inbox: MailInbox,
  ) {}

  static configured() {
    return !!process.env.IMAP_URL;
  }

  /** Bootstrapped by MailSettingsService, once the saved configuration is applied. */
  onApplicationBootstrap() {}

  /** Starts, restarts or stops polling after the configuration changed. */
  reconfigure() {
    clearInterval(this.timer);
    this.timer = undefined;
    if (isDemo() || !ImapPoller.configured()) return;
    let host = '?';
    try {
      host = new URL(process.env.IMAP_URL!).host;
    } catch {}
    this.logger.log(`Reading replies from IMAP at ${host} every ${Math.round(imapPollMs() / 1000)} s`);
    this.timer = setInterval(() => void this.poll(), imapPollMs());
    void this.poll();
  }

  async onApplicationShutdown() {
    clearInterval(this.timer);
    await this.running;
  }

  /** One pass; returns how many messages were stored. */
  poll(): Promise<void> {
    this.running ??= this.read()
      .catch(async (err) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`IMAP: ${message}`);
        const mailbox = process.env.IMAP_MAILBOX || 'INBOX';
        const cursor = await this.repo.cursor(mailbox);
        await this.repo.saveCursor(mailbox, cursor?.uidValidity ?? 0, cursor?.lastUid ?? 0, message.slice(0, 500)).catch(() => undefined);
      })
      .finally(() => (this.running = undefined));
    return this.running;
  }

  private async read() {
    const url = new URL(process.env.IMAP_URL!);
    const mailbox = process.env.IMAP_MAILBOX || 'INBOX';
    const client = new ImapFlow({
      host: url.hostname,
      port: Number(url.port || (url.protocol === 'imaps:' ? 993 : 143)),
      secure: url.protocol === 'imaps:',
      auth: { user: decodeURIComponent(url.username), pass: decodeURIComponent(url.password) },
      logger: false,
    });
    await client.connect();
    try {
      const box = await client.mailboxOpen(mailbox, { readOnly: true });
      const uidValidity = Number(box.uidValidity);
      const cursor = await this.repo.cursor(mailbox);
      // First run, or the mailbox was rebuilt (new UIDVALIDITY): start after the newest message.
      if (!cursor || cursor.uidValidity !== uidValidity) {
        await this.repo.saveCursor(mailbox, uidValidity, Number(box.uidNext) - 1, null);
        return;
      }
      let last = cursor.lastUid;
      let stored = 0;
      if (Number(box.uidNext) - 1 > last) {
        // Sizes first: an oversized message is skipped without downloading it.
        const pending: { uid: number; size: number }[] = [];
        for await (const msg of client.fetch(`${last + 1}:*`, { uid: true, size: true }, { uid: true })) {
          if (msg.uid > last) pending.push({ uid: msg.uid, size: msg.size ?? 0 });
        }
        for (const { uid, size } of pending.sort((a, b) => a.uid - b.uid)) {
          // One bad message must not stop the mailbox: it is logged and passed, and the cursor moves on.
          try {
            if (size > MAX_MESSAGE_BYTES) this.logger.warn(`IMAP: message ${uid} skipped (${Math.round(size / 1024 / 1024)} MB)`);
            else {
              const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
              if (msg && msg.source && (await this.inbox.ingest(msg.source)).status === 'stored') stored++;
            }
          } catch (err) {
            this.logger.warn(`IMAP: message ${uid} could not be stored: ${err instanceof Error ? err.message : err}`);
          }
          last = uid;
          await this.repo.saveCursor(mailbox, uidValidity, last, null);
        }
      }
      await this.repo.saveCursor(mailbox, uidValidity, last, null);
      if (stored) this.logger.log(`IMAP: ${stored} new message(s)`);
    } finally {
      await client.logout().catch(() => undefined);
    }
  }
}
