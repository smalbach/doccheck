import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ImapFlow } from 'imapflow';
import { createTransport } from 'nodemailer';
import type { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { isDemo } from '../demo/demo-mode';
import { ImapPoller } from './imap.poller';
import type { MailServerDto } from './mail-settings.dto';
import { open, seal, type Sealed } from './secret-box';

const KEY = 'mailServer';
/** What the mail code reads; a saved configuration writes them, a reset puts .env back. */
const ENV_KEYS = ['SMTP_URL', 'MAIL_FROM', 'MAIL_REPLY_TO', 'MAIL_PLUS_ADDRESSING', 'IMAP_URL', 'IMAP_MAILBOX', 'IMAP_POLL_MS', 'MAIL_INTAKE', 'MAIL_INTAKE_NOTIFY'] as const;

interface Server {
  host: string;
  port: number;
  secure: boolean;
  user: string;
}
type Stored = Omit<MailServerDto, 'smtp' | 'imap'> & {
  smtp: (Server & { password?: Sealed }) | null;
  imap: (Server & { password?: Sealed; mailbox: string; pollSeconds: number }) | null;
};

/** The configuration as the admin page shows it: passwords only as "set". */
export type MailServerView = Omit<MailServerDto, 'smtp' | 'imap'> & {
  smtp: (Server & { hasPassword: boolean }) | null;
  imap: (Server & { hasPassword: boolean; mailbox: string; pollSeconds: number }) | null;
};

const urlOf = (scheme: 'smtp' | 'imap', s: Server, password: string | undefined) => {
  const auth = s.user ? `${encodeURIComponent(s.user)}${password ? `:${encodeURIComponent(password)}` : ''}@` : '';
  return `${scheme}${s.secure ? 's' : ''}://${auth}${s.host}:${s.port}`;
};

/** "smtps://user:pass@host:465" as fields (the password only as "set"). */
function parseUrl(url: string | undefined, defaultPort: number): (Server & { hasPassword: boolean }) | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return { host: u.hostname, port: Number(u.port || defaultPort), secure: /s:$/.test(u.protocol), user: decodeURIComponent(u.username), hasPassword: !!u.password };
  } catch {
    return null;
  }
}

/**
 * The mail server (SMTP to send, IMAP to read, addresses, documents by email), set by an admin from
 * the web and stored with its passwords sealed (secret-box.ts). A saved configuration overrides
 * .env until it is reset; it is applied by writing the variables the mail code reads.
 */
@Injectable()
export class MailSettingsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MailSettingsService.name);
  private readonly envAtStart = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]])) as Record<(typeof ENV_KEYS)[number], string | undefined>;
  private stored?: { value: Stored; updatedAt: string; updatedBy?: string };

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly poller: ImapPoller,
  ) {}

  async onApplicationBootstrap() {
    // The read-only demo keeps .env, like the other settings.
    if (!isDemo()) {
      const { rows } = await this.pool.query('select s.value, s.updated_at, u.email from settings s left join users u on u.id = s.updated_by where s.key = $1', [KEY]);
      if (rows[0]) {
        this.stored = { value: rows[0].value, updatedAt: new Date(rows[0].updated_at).toISOString(), ...(rows[0].email ? { updatedBy: rows[0].email } : {}) };
        this.apply(this.stored.value);
      }
    }
    this.poller.reconfigure();
  }

  view(): { source: 'admin' | 'env' | 'none'; config: MailServerView | null; updatedAt?: string; updatedBy?: string; editable: boolean } {
    const editable = !isDemo();
    if (this.stored) {
      const v = this.stored.value;
      return {
        source: 'admin',
        editable,
        updatedAt: this.stored.updatedAt,
        ...(this.stored.updatedBy ? { updatedBy: this.stored.updatedBy } : {}),
        config: {
          ...v,
          smtp: v.smtp ? { host: v.smtp.host, port: v.smtp.port, secure: v.smtp.secure, user: v.smtp.user, hasPassword: !!v.smtp.password } : null,
          imap: v.imap ? { host: v.imap.host, port: v.imap.port, secure: v.imap.secure, user: v.imap.user, hasPassword: !!v.imap.password, mailbox: v.imap.mailbox, pollSeconds: v.imap.pollSeconds } : null,
        },
      };
    }
    const env = this.envAtStart;
    const smtp = parseUrl(env.SMTP_URL, 465);
    const imap = parseUrl(env.IMAP_URL, 993);
    if (!smtp && !imap && !env.MAIL_FROM) return { source: 'none', config: null, editable };
    return {
      source: 'env',
      editable,
      config: {
        smtp,
        from: env.MAIL_FROM ?? '',
        replyTo: env.MAIL_REPLY_TO || null,
        plusAddressing: env.MAIL_PLUS_ADDRESSING !== 'false',
        imap: imap ? { ...imap, mailbox: env.IMAP_MAILBOX || 'INBOX', pollSeconds: Math.round(Number(env.IMAP_POLL_MS ?? 60000) / 1000) || 60 } : null,
        intake: { enabled: env.MAIL_INTAKE === 'true', notifySender: env.MAIL_INTAKE_NOTIFY !== 'false' },
      },
    };
  }

  async save(dto: MailServerDto, userId: string) {
    if (isDemo()) throw new ForbiddenException('Settings are read-only in the demo');
    const value = this.merge(dto);
    if (value.imap && !value.imap.password) throw new BadRequestException('Enter the mailbox password (for Gmail, an app password)');
    await this.pool.query(
      `insert into settings (key, value, updated_by) values ($1, $2, $3)
       on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`,
      [KEY, JSON.stringify(value), userId],
    );
    const { rows } = await this.pool.query('select email from users where id = $1', [userId]);
    this.stored = { value, updatedAt: new Date().toISOString(), ...(rows[0]?.email ? { updatedBy: rows[0].email } : {}) };
    this.apply(value);
    this.poller.reconfigure();
    this.logger.log(`Mail server saved: SMTP ${value.smtp ? value.smtp.host : 'off'}, IMAP ${value.imap ? value.imap.host : 'off'}, documents by email ${value.intake.enabled ? 'on' : 'off'}`);
    return this.view();
  }

  async reset() {
    if (isDemo()) throw new ForbiddenException('Settings are read-only in the demo');
    await this.pool.query('delete from settings where key = $1', [KEY]);
    this.stored = undefined;
    for (const k of ENV_KEYS) {
      if (this.envAtStart[k] === undefined) delete process.env[k];
      else process.env[k] = this.envAtStart[k];
    }
    this.poller.reconfigure();
    return this.view();
  }

  /**
   * Tries the SMTP server (log in, then a test email to `to`) or the IMAP mailbox (log in, open it)
   * with `dto` (unsaved values; empty passwords take the saved ones) or what is saved.
   */
  async test(kind: 'smtp' | 'imap', dto: MailServerDto | undefined, to: string): Promise<{ ok: boolean; detail: string }> {
    const value = dto ? this.merge(dto) : this.stored?.value;
    const server = value?.[kind];
    if (!value || !server) return { ok: false, detail: kind === 'smtp' ? 'No SMTP server set' : 'No IMAP mailbox set' };
    const password = server.password ? open(server.password) : undefined;
    try {
      if (kind === 'smtp') {
        const transport = createTransport({ host: server.host, port: server.port, secure: server.secure, auth: server.user ? { user: server.user, pass: password ?? '' } : undefined, connectionTimeout: 10_000, greetingTimeout: 10_000 });
        await transport.verify();
        await transport.sendMail({ from: value.from, to, subject: 'DocCheck: mail server test', text: 'This message was sent from the DocCheck settings page to check the SMTP server.' });
        return { ok: true, detail: `Sent a test email to ${to}` };
      }
      const client = new ImapFlow({ host: server.host, port: server.port, secure: server.secure, auth: { user: server.user, pass: password ?? '' }, logger: false, connectionTimeout: 10_000, greetingTimeout: 10_000 });
      await client.connect();
      try {
        const box = await client.mailboxOpen(value.imap!.mailbox, { readOnly: true });
        return { ok: true, detail: `Opened ${value.imap!.mailbox}: ${box.exists} messages` };
      } finally {
        await client.logout().catch(() => undefined);
      }
    } catch (err) {
      // Server answers only: never the credentials.
      return { ok: false, detail: (err instanceof Error ? (err as { response?: string }).response || err.message : String(err)).slice(0, 300) };
    }
  }

  /**
   * The DTO with its passwords sealed. An empty password keeps the saved one, or, while the
   * configuration still comes from .env, the one in SMTP_URL / IMAP_URL for the same server and user.
   */
  private merge(dto: MailServerDto): Stored {
    const saved = this.stored?.value;
    const fromEnv = (kind: 'smtp' | 'imap'): Sealed | undefined => {
      const server = dto[kind];
      const raw = this.envAtStart[kind === 'smtp' ? 'SMTP_URL' : 'IMAP_URL'];
      if (!server || !raw) return undefined;
      try {
        const u = new URL(raw);
        const same = u.hostname === server.host && decodeURIComponent(u.username) === server.user;
        return same && u.password ? seal(decodeURIComponent(u.password)) : undefined;
      } catch {
        return undefined;
      }
    };
    const keep = (kind: 'smtp' | 'imap', given: string | undefined) => (given ? seal(given) : (saved?.[kind]?.password ?? fromEnv(kind)));
    return {
      ...dto,
      smtp: dto.smtp ? { host: dto.smtp.host, port: dto.smtp.port, secure: dto.smtp.secure, user: dto.smtp.user, password: keep('smtp', dto.smtp.password) } : null,
      imap: dto.imap ? { host: dto.imap.host, port: dto.imap.port, secure: dto.imap.secure, user: dto.imap.user, mailbox: dto.imap.mailbox, pollSeconds: dto.imap.pollSeconds, password: keep('imap', dto.imap.password) } : null,
    };
  }

  private apply(v: Stored) {
    const set = (k: (typeof ENV_KEYS)[number], value: string | undefined) => {
      if (value === undefined || value === '') delete process.env[k];
      else process.env[k] = value;
    };
    set('SMTP_URL', v.smtp ? urlOf('smtp', v.smtp, v.smtp.password && open(v.smtp.password)) : undefined);
    set('MAIL_FROM', v.from);
    set('MAIL_REPLY_TO', v.replyTo ?? undefined);
    set('MAIL_PLUS_ADDRESSING', String(v.plusAddressing));
    set('IMAP_URL', v.imap ? urlOf('imap', v.imap, v.imap.password && open(v.imap.password)) : undefined);
    set('IMAP_MAILBOX', v.imap?.mailbox);
    set('IMAP_POLL_MS', v.imap ? String(v.imap.pollSeconds * 1000) : undefined);
    set('MAIL_INTAKE', String(v.intake.enabled));
    set('MAIL_INTAKE_NOTIFY', String(v.intake.notifySender));
    if ((v.smtp?.password && !open(v.smtp.password)) || (v.imap?.password && !open(v.imap.password))) {
      this.logger.error('Saved mail passwords cannot be read with this SETTINGS_KEY: enter them again in the settings');
    }
  }
}
