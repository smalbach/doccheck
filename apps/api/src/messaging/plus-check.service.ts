import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { replyBase } from './mail.config';

const KEY = 'mailPlusCheck';
/** Without an answer by then, the check says it could not confirm the address. */
const WAIT_MS = 15 * 60_000;

/** The token of a check address: "docs+probe-k3x9p2ab@example.com". */
export const PROBE_IN_ADDRESS = /\+(probe-[a-z0-9]{8})@/i;

/**
 * Whether the mail server takes "+code" addresses. checking: a test email was sent to one; ok: it
 * arrived; rejected: it bounced (+codes were then turned off); unconfirmed: no answer, or it could
 * not be sent.
 */
export interface PlusCheck {
  status: 'checking' | 'ok' | 'rejected' | 'unconfirmed';
  address: string;
  checkedAt: string;
  detail?: string;
  /** rejected: DocCheck turned +codes off. */
  turnedOff?: boolean;
}

/**
 * Checks that replies to "mailbox+code@" reach the mailbox: some servers (Hostinger, many hosting
 * mailboxes) reject them, and the people who answer get "address not found". A test email goes to a
 * +probe address when the settings are saved; its arrival, a rejection by the SMTP server, or a
 * delivery report for it (or for any of our +addresses) settles the check. A rejection turns +codes
 * off: replies still find their conversation by In-Reply-To/References and the [DC-…] in the subject.
 */
@Injectable()
export class PlusCheckService implements OnModuleInit {
  private readonly logger = new Logger(PlusCheckService.name);
  private state: (PlusCheck & { token?: string }) | null = null;
  /** Set by the mail settings: turns +codes off. */
  onRejected?: () => Promise<boolean>;

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onModuleInit() {
    const { rows } = await this.pool.query('select value from settings where key = $1', [KEY]);
    this.state = rows[0]?.value ?? null;
  }

  /** The last check as the settings page shows it (no token). */
  current(): PlusCheck | null {
    if (!this.state) return null;
    const { token: _token, ...check } = this.state;
    if (check.status === 'checking' && Date.now() - Date.parse(check.checkedAt) > WAIT_MS) {
      return { ...check, status: 'unconfirmed', detail: 'The test email did not come back to the mailbox' };
    }
    return check;
  }

  /** Whether the current reply mailbox already passed. */
  passed(): boolean {
    return this.state?.status === 'ok' && this.state.address.replace(PROBE_IN_ADDRESS, '@') === replyBase();
  }

  /** Sends the test email with `send` (which throws what the SMTP server answered). */
  async start(send: (to: string, token: string) => Promise<{ rejected?: unknown[] }>): Promise<void> {
    const [local, domain] = replyBase().split('@');
    if (!local || !domain) return;
    const token = `probe-${randomBytes(4).toString('hex')}`;
    const address = `${local}+${token}@${domain}`;
    await this.save({ status: 'checking', address, checkedAt: new Date().toISOString(), token });
    try {
      const info = await send(address, token);
      if (info.rejected?.length) await this.reject(address, 'The SMTP server refused the address');
    } catch (err) {
      const e = err as { responseCode?: number; response?: string; message?: string };
      const answer = (e.response || e.message || String(err)).slice(0, 300);
      // 5xx for the recipient: the server says the address does not exist.
      if (e.responseCode && e.responseCode >= 500 && e.responseCode < 600) await this.reject(address, answer);
      else await this.save({ status: 'unconfirmed', address, checkedAt: new Date().toISOString(), detail: answer });
    }
  }

  async clear(): Promise<void> {
    this.state = null;
    await this.pool.query('delete from settings where key = $1', [KEY]);
  }

  /** The test email arrived (`token` from the address it was sent to). */
  async arrived(token: string): Promise<boolean> {
    if (this.state?.token !== token.toLowerCase()) return false;
    if (this.state.status === 'checking' || this.state.status === 'unconfirmed') {
      await this.save({ status: 'ok', address: this.state.address, checkedAt: new Date().toISOString() });
      this.logger.log(`Plus addressing works: ${this.state.address} reached the mailbox`);
    }
    return true;
  }

  /** Whether `address` is one of ours: the reply mailbox with a "+code". */
  isOwnPlusAddress(address: string): boolean {
    const [local, domain] = replyBase().split('@');
    const a = address.trim().toLowerCase();
    return !!local && !!domain && a.startsWith(`${local}+`) && a.endsWith(`@${domain}`) && !a.slice(local.length + 1, -domain.length - 1).includes('@');
  }

  /** The pending check, to find it in a delivery report that does not name its recipient. */
  pending(): { token: string; address: string } | undefined {
    const s = this.state;
    return s?.token && (s.status === 'checking' || s.status === 'unconfirmed') ? { token: s.token, address: s.address } : undefined;
  }

  /** Mail to `address` (one of ours) bounced: +codes do not work with this server. */
  async reject(address: string, detail: string): Promise<void> {
    if (this.state?.status === 'rejected') return;
    const turnedOff = (await this.onRejected?.().catch(() => false)) ?? false;
    await this.save({ status: 'rejected', address, checkedAt: new Date().toISOString(), detail: detail.slice(0, 300), turnedOff });
    this.logger.warn(`Plus addressing rejected: mail to ${address} bounced${turnedOff ? '; +codes turned off' : ''}`);
  }

  private async save(value: PlusCheck & { token?: string }) {
    this.state = value;
    await this.pool.query(
      `insert into settings (key, value) values ($1, $2)
       on conflict (key) do update set value = excluded.value, updated_at = now()`,
      [KEY, JSON.stringify(value)],
    );
  }
}
