import { Inject, Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../db/db.module';
import type { MailAttachment, MailMessage, MailSummary, MessageStatus, ThreadKind, ThreadStatus, ThreadSummary } from './mail.types';

export type ThreadFilter = 'all' | 'open' | 'unread' | 'awaiting' | 'overdue' | 'failed' | 'closed';

export interface ThreadRow {
  id: string;
  userId: string;
  /** Taken from the shipment, else the user's current organization, when not given. */
  orgId?: string;
  shipmentId?: string;
  partyId?: string;
  token: string;
  kind: ThreadKind;
  subject: string;
  status: ThreadStatus;
  language?: string;
  fingerprints: string[];
}

export interface NewMessage {
  id: string;
  threadId: string | null;
  userId: string | null;
  direction: 'out' | 'in';
  status: MessageStatus;
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  text: string;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  receivedAt?: string | null;
  senderCheck?: 'pass' | 'fail' | 'none';
}

/** An outgoing message claimed by the outbox, with what sending it needs. */
export interface OutboxItem {
  id: string;
  threadToken: string | null;
  /** The thread's language, else its owner's: for the HTML footer. */
  language: string | null;
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  text: string;
  messageId: string;
  inReplyTo: string | null;
  references: string[];
  attempts: number;
}

const FILTERS: Record<ThreadFilter, string> = {
  all: 'true',
  open: `t.status <> 'closed'`,
  unread: 't.unread > 0',
  awaiting: `t.status = 'awaiting'`,
  overdue: `t.status = 'awaiting' and t.due_at < now()`,
  failed: `exists (select 1 from mail_messages f where f.thread_id = t.id and f.status = 'failed')`,
  closed: `t.status = 'closed'`,
};

const SUMMARY_COLUMNS = `t.*, s.reference as shipment_reference, p.name as party_name,
  (t.status = 'awaiting' and t.due_at is not null and t.due_at < now()) as overdue,
  exists (select 1 from mail_messages f where f.thread_id = t.id and f.status = 'failed') as failed,
  (select count(*)::int from mail_messages m where m.thread_id = t.id) as message_count,
  (select case when m.direction = 'in' then m.from_addr else m.to_addrs[1] end from mail_messages m
    where m.thread_id = t.id order by m.created_at desc limit 1) as counterpart`;

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : undefined);

const toSummary = (r: Record<string, unknown>): ThreadSummary => ({
  id: r.id as string,
  kind: r.kind as ThreadKind,
  status: r.status as ThreadStatus,
  subject: r.subject as string,
  ...(r.shipment_id ? { shipmentId: r.shipment_id as string } : {}),
  ...(r.shipment_reference ? { shipmentReference: r.shipment_reference as string } : {}),
  ...(r.party_id ? { partyId: r.party_id as string } : {}),
  ...(r.party_name ? { partyName: r.party_name as string } : {}),
  unread: r.unread as number,
  overdue: r.overdue as boolean,
  ...(r.due_at ? { dueAt: iso(r.due_at) } : {}),
  failed: r.failed as boolean,
  ...(r.counterpart ? { counterpart: r.counterpart as string } : {}),
  lastMessageAt: iso(r.last_message_at)!,
  createdAt: iso(r.created_at)!,
  messages: r.message_count as number,
});

const toMessage = (r: Record<string, unknown>, attachments: MailAttachment[]): MailMessage => ({
  id: r.id as string,
  ...(r.thread_id ? { threadId: r.thread_id as string } : {}),
  direction: r.direction as 'out' | 'in',
  status: r.status as MessageStatus,
  from: r.from_addr as string,
  to: r.to_addrs as string[],
  cc: r.cc_addrs as string[],
  subject: r.subject as string,
  text: r.text_body as string,
  attempts: r.attempts as number,
  ...(r.error ? { error: r.error as string } : {}),
  ...(r.transport ? { transport: r.transport as string } : {}),
  ...(r.user_name ? { userName: r.user_name as string } : {}),
  ...(r.sent_at ? { sentAt: iso(r.sent_at) } : {}),
  ...(r.received_at ? { receivedAt: iso(r.received_at) } : {}),
  ...(r.read_at ? { readAt: iso(r.read_at) } : {}),
  ...(r.sender_check === 'fail' ? { senderUnverified: true } : {}),
  createdAt: iso(r.created_at)!,
  attachments,
});

const toAttachment = (r: Record<string, unknown>): MailAttachment => ({
  id: r.id as string,
  filename: r.filename as string,
  contentType: r.content_type as string,
  size: r.size as number,
  ...(r.document_id ? { documentId: r.document_id as string } : {}),
});

@Injectable()
export class MailRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await work(client);
      await client.query('commit');
      return result;
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  }

  async insertThread(t: ThreadRow & { dueAt: string | null }, db: PoolClient | Pool = this.pool): Promise<void> {
    await db.query(
      `insert into mail_threads (id, user_id, shipment_id, party_id, token, kind, subject, status, language, fingerprints, due_at, org_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
         coalesce($12::uuid, (select org_id from shipments where id = $3), (select last_org_id from users where id = $2), dc_personal_org($2)))`,
      [t.id, t.userId, t.shipmentId ?? null, t.partyId ?? null, t.token, t.kind, t.subject, t.status, t.language ?? null, t.fingerprints, t.dueAt, t.orgId ?? null],
    );
  }

  async insertMessage(m: NewMessage, db: PoolClient | Pool = this.pool): Promise<void> {
    await db.query(
      `insert into mail_messages (id, thread_id, user_id, direction, status, from_addr, to_addrs, cc_addrs, subject, text_body, message_id, in_reply_to, "references", next_attempt_at, received_at, sender_check)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        m.id, m.threadId, m.userId, m.direction, m.status, m.from, m.to, m.cc, m.subject, m.text, m.messageId, m.inReplyTo, m.references,
        m.status === 'queued' ? new Date().toISOString() : null, m.receivedAt ?? null, m.senderCheck ?? null,
      ],
    );
  }

  async insertAttachment(a: { id: string; messageId: string; filename: string; contentType: string; size: number; storageKey: string }): Promise<void> {
    await this.pool.query('insert into mail_attachments (id, message_id, filename, content_type, size, storage_key) values ($1, $2, $3, $4, $5, $6)', [
      a.id, a.messageId, a.filename, a.contentType, a.size, a.storageKey,
    ]);
  }

  /** Our message went out: the thread waits for an answer again, until `dueAt`. */
  async touchThreadOut(threadId: string, dueAt: string, db: PoolClient | Pool = this.pool): Promise<void> {
    await db.query(`update mail_threads set status = 'awaiting', due_at = $2, last_message_at = now(), closed_at = null where id = $1`, [threadId, dueAt]);
  }

  /** A reply arrived: to read, and nothing is overdue any more. */
  async touchThreadIn(threadId: string): Promise<void> {
    await this.pool.query(`update mail_threads set status = 'replied', unread = unread + 1, due_at = null, last_message_at = now(), closed_at = null where id = $1`, [threadId]);
  }

  async listThreads(orgId: string, q: { filter: ThreadFilter; q?: string; shipmentId?: string; partyId?: string; limit: number; offset: number }) {
    const params: unknown[] = [orgId];
    const where = [FILTERS[q.filter]];
    if (q.shipmentId) {
      params.push(q.shipmentId);
      where.push(`t.shipment_id = $${params.length}`);
    }
    if (q.partyId) {
      params.push(q.partyId);
      where.push(`t.party_id = $${params.length}`);
    }
    if (q.q) {
      params.push(`%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
      const n = `$${params.length}`;
      where.push(`(t.subject ilike ${n} or s.reference ilike ${n} or p.name ilike ${n}
        or exists (select 1 from mail_messages m where m.thread_id = t.id and (m.from_addr ilike ${n} or array_to_string(m.to_addrs, ' ') ilike ${n} or m.text_body ilike ${n})))`);
    }
    const from = `from mail_threads t left join shipments s on s.id = t.shipment_id left join parties p on p.id = t.party_id
      where t.org_id = $1 and ${where.join(' and ')}`;
    const [{ rows }, { rows: [count] }] = await Promise.all([
      this.pool.query(`select ${SUMMARY_COLUMNS} ${from} order by t.last_message_at desc, t.id limit $${params.length + 1} offset $${params.length + 2}`, [...params, q.limit, q.offset]),
      this.pool.query(`select count(*)::int as n ${from}`, params),
    ]);
    return { items: rows.map(toSummary), total: count.n as number };
  }

  async findThread(id: string): Promise<(ThreadRow & { summary: ThreadSummary }) | null> {
    const { rows } = await this.pool.query(
      `select ${SUMMARY_COLUMNS} from mail_threads t left join shipments s on s.id = t.shipment_id left join parties p on p.id = t.party_id where t.id = $1`,
      [id],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      userId: r.user_id,
      orgId: r.org_id,
      ...(r.shipment_id ? { shipmentId: r.shipment_id } : {}),
      ...(r.party_id ? { partyId: r.party_id } : {}),
      token: r.token,
      kind: r.kind,
      subject: r.subject,
      status: r.status,
      ...(r.language ? { language: r.language } : {}),
      fingerprints: r.fingerprints,
      summary: toSummary(r),
    };
  }

  /** Messages of a thread (or the unassigned ones with `null`), oldest first, with attachments. */
  async messages(threadId: string | null, limit = 500): Promise<MailMessage[]> {
    const { rows } = await this.pool.query(
      `select m.*, u.name as user_name from mail_messages m left join users u on u.id = m.user_id
       where ${threadId ? 'm.thread_id = $1' : 'm.thread_id is null and $1::uuid is null'} order by m.created_at ${threadId ? 'asc' : 'desc'}, m.id limit $2`,
      [threadId, limit],
    );
    if (rows.length === 0) return [];
    const { rows: files } = await this.pool.query('select * from mail_attachments where message_id = any($1) order by created_at, filename', [rows.map((r) => r.id)]);
    return rows.map((r) => toMessage(r, files.filter((f) => f.message_id === r.id).map(toAttachment)));
  }

  async markRead(threadId: string): Promise<void> {
    await this.pool.query(`update mail_threads set unread = 0 where id = $1`, [threadId]);
    await this.pool.query(`update mail_messages set read_at = now() where thread_id = $1 and direction = 'in' and read_at is null`, [threadId]);
  }

  async setStatus(threadId: string, status: ThreadStatus): Promise<void> {
    await this.pool.query(`update mail_threads set status = $2, closed_at = case when $2 = 'closed' then now() end, due_at = case when $2 = 'closed' then null else due_at end where id = $1`, [threadId, status]);
  }

  async summary(orgId: string, admin: boolean): Promise<MailSummary> {
    const { rows: [r] } = await this.pool.query(
      `select coalesce(sum(t.unread), 0)::int as unread,
         (count(*) filter (where t.status = 'awaiting'))::int as awaiting,
         (count(*) filter (where t.status = 'awaiting' and t.due_at < now()))::int as overdue,
         (count(*) filter (where exists (select 1 from mail_messages f where f.thread_id = t.id and f.status = 'failed')))::int as failed
       from mail_threads t where t.org_id = $1 and t.status <> 'closed'`,
      [orgId],
    );
    if (!admin) return r;
    const { rows: [u] } = await this.pool.query(`select count(*)::int as n from mail_messages where thread_id is null`);
    return { ...r, unassigned: u.n };
  }

  // Outbox ------------------------------------------------------------------------------------------

  /** Takes up to `limit` queued messages that are due, marking them sending (skip locked: one sender each). */
  async claimOutbox(limit: number): Promise<OutboxItem[]> {
    const { rows } = await this.pool.query(
      `update mail_messages m set status = 'sending', attempts = attempts + 1
       where id in (select id from mail_messages where status = 'queued' and next_attempt_at <= now() order by next_attempt_at limit $1 for update skip locked)
       returning m.*, (select token from mail_threads t where t.id = m.thread_id) as token,
         (select coalesce(t.language, u.language) from mail_threads t join users u on u.id = t.user_id where t.id = m.thread_id) as language`,
      [limit],
    );
    return rows.map((r) => ({
      id: r.id,
      threadToken: r.token,
      language: r.language,
      from: r.from_addr,
      to: r.to_addrs,
      cc: r.cc_addrs,
      subject: r.subject,
      text: r.text_body,
      messageId: r.message_id,
      inReplyTo: r.in_reply_to,
      references: r.references,
      attempts: r.attempts,
    }));
  }

  async markSent(id: string, transport: string): Promise<void> {
    await this.pool.query(`update mail_messages set status = 'sent', sent_at = now(), error = null, transport = $2, next_attempt_at = null where id = $1`, [id, transport]);
  }

  async markRetry(id: string, error: string, at: Date | null): Promise<void> {
    await this.pool.query(
      `update mail_messages set status = case when $3::timestamptz is null then 'failed' else 'queued' end, error = $2, next_attempt_at = $3 where id = $1`,
      [id, error.slice(0, 2000), at?.toISOString() ?? null],
    );
  }

  /** Puts a failed message back in the queue now. */
  async requeue(id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(`update mail_messages set status = 'queued', next_attempt_at = now(), attempts = 0, error = null where id = $1 and status = 'failed'`, [id]);
    return rowCount === 1;
  }

  /** Messages left sending by a process that stopped: queued again. */
  async recoverStuck(): Promise<number> {
    const { rowCount } = await this.pool.query(
      `update mail_messages set status = 'queued', next_attempt_at = now() where status = 'sending' and coalesce(next_attempt_at, created_at) < now() - interval '5 minutes'`,
    );
    return rowCount ?? 0;
  }

  // Inbound ----------------------------------------------------------------------------------------

  async hasMessageId(messageId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query('select 1 from mail_messages where message_id = $1', [messageId]);
    return (rowCount ?? 0) > 0;
  }

  /** The thread one of these Message-IDs belongs to (the latest message first). */
  async threadByMessageIds(ids: string[]): Promise<string | null> {
    if (ids.length === 0) return null;
    const { rows } = await this.pool.query(`select thread_id from mail_messages where message_id = any($1) and thread_id is not null order by created_at desc limit 1`, [ids]);
    return rows[0]?.thread_id ?? null;
  }

  async threadByToken(token: string): Promise<string | null> {
    const { rows } = await this.pool.query('select id from mail_threads where token = $1', [token.toLowerCase()]);
    return rows[0]?.id ?? null;
  }

  async messageById(id: string): Promise<(MailMessage & { userId?: string; threadUserId?: string; threadOrgId?: string }) | null> {
    const { rows } = await this.pool.query(
      `select m.*, t.user_id as thread_user_id, t.org_id as thread_org_id from mail_messages m left join mail_threads t on t.id = m.thread_id where m.id = $1`,
      [id],
    );
    if (!rows[0]) return null;
    const { rows: files } = await this.pool.query('select * from mail_attachments where message_id = $1 order by created_at, filename', [id]);
    return { ...toMessage(rows[0], files.map(toAttachment)), ...(rows[0].thread_user_id ? { threadUserId: rows[0].thread_user_id } : {}), ...(rows[0].thread_org_id ? { threadOrgId: rows[0].thread_org_id } : {}) };
  }

  /** An outgoing message bounced: failed, with the report's subject. */
  async markBounced(messageId: string, error: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(`update mail_messages set status = 'failed', error = $2 where message_id = $1 and direction = 'out'`, [messageId, error.slice(0, 500)]);
    return (rowCount ?? 0) > 0;
  }

  async assignMessage(id: string, threadId: string): Promise<void> {
    await this.pool.query('update mail_messages set thread_id = $2 where id = $1 and thread_id is null', [id, threadId]);
  }

  async attachment(id: string): Promise<{ id: string; messageId: string; threadId?: string; userId?: string; orgId?: string; filename: string; contentType: string; storageKey: string; documentId?: string } | null> {
    const { rows } = await this.pool.query(
      `select a.*, m.thread_id, t.user_id, t.org_id from mail_attachments a join mail_messages m on m.id = a.message_id left join mail_threads t on t.id = m.thread_id where a.id = $1`,
      [id],
    );
    const r = rows[0];
    return r
      ? { id: r.id, messageId: r.message_id, ...(r.thread_id ? { threadId: r.thread_id } : {}), ...(r.user_id ? { userId: r.user_id } : {}), ...(r.org_id ? { orgId: r.org_id } : {}), filename: r.filename, contentType: r.content_type, storageKey: r.storage_key, ...(r.document_id ? { documentId: r.document_id } : {}) }
      : null;
  }

  async linkAttachment(id: string, documentId: string): Promise<void> {
    await this.pool.query('update mail_attachments set document_id = $2 where id = $1', [id, documentId]);
  }

  // Contacts ---------------------------------------------------------------------------------------

  /**
   * Addresses to suggest: whoever emailed the shipment's documents in (newest first), then the
   * organization's saved contacts (for the company first), then the emails the company's documents print.
   */
  async contacts(orgId: string, partyId?: string, shipmentId?: string): Promise<{ email: string; name?: string; source: 'received' | 'saved' | 'document'; partyId?: string }[]> {
    const { rows } = await this.pool.query(
      `select email, name, source, party_id from (
         select lower(coalesce(substring(m.from_addr from '<([^<>]+)>\\s*$'), m.from_addr)) as email,
                nullif(trim(both ' "' from substring(m.from_addr from '^(.*)<[^<>]+>\\s*$')), '') as name,
                'received' as source, t.party_id, 0 as rank, m.received_at as at
         from mail_messages m join mail_threads t on t.id = m.thread_id
         where $3::uuid is not null and t.shipment_id = $3 and t.org_id = $1 and m.direction = 'in' and m.status = 'received'
           and m.sender_check is distinct from 'fail'
         union all
         select lower(c.email), c.name, 'saved', c.party_id, case when c.party_id is not distinct from $2::uuid then 1 else 3 end, c.last_used_at
         from mail_contacts c where c.org_id = $1
         union all
         select lower(dp.contact_email), dp.contact_name, 'document', dp.party_id, 2, null
         from document_parties dp where dp.org_id = $1 and dp.contact_email ~ '^[^@\\s]+@[^@\\s]+$' and $2::uuid is not null and dp.party_id = $2
       ) c
       where email ~ '^[^@\\s]+@[^@\\s]+$'
       order by rank, at desc nulls last`,
      [orgId, partyId ?? null, shipmentId ?? null],
    );
    const seen = new Set<string>();
    return rows
      .filter((r) => !seen.has(r.email) && seen.add(r.email))
      .slice(0, 20)
      .map((r) => ({ email: r.email, ...(r.name ? { name: r.name } : {}), source: r.source, ...(r.party_id ? { partyId: r.party_id } : {}) }));
  }

  async saveContacts(orgId: string, userId: string, partyId: string | undefined, emails: string[]): Promise<void> {
    for (const email of emails) {
      await this.pool.query(
        `insert into mail_contacts (id, org_id, user_id, party_id, email) values (gen_random_uuid(), $1, $2, $3, $4)
         on conflict (org_id, email) do update set last_used_at = now(), party_id = coalesce(excluded.party_id, mail_contacts.party_id)`,
        [orgId, userId, partyId ?? null, email.toLowerCase()],
      );
    }
  }

  /** How many messages `userId` (or everyone, with null) queued since `interval` ago. */
  async sentSince(db: PoolClient | Pool, userId: string | null, interval: string): Promise<number> {
    const { rows } = await db.query(
      `select count(*)::int as n from mail_messages where direction = 'out' and created_at > now() - $2::interval and ($1::uuid is null or user_id = $1)`,
      [userId, interval],
    );
    return rows[0].n;
  }

  /** Drops received mail no conversation claimed after `days`. */
  async pruneUnassigned(days: number): Promise<number> {
    const { rowCount } = await this.pool.query(`delete from mail_messages where thread_id is null and created_at < now() - make_interval(days => $1)`, [days]);
    return rowCount ?? 0;
  }

  // IMAP cursor ------------------------------------------------------------------------------------

  async cursor(mailbox: string): Promise<{ uidValidity: number; lastUid: number } | null> {
    const { rows } = await this.pool.query('select uid_validity, last_uid from mail_cursors where mailbox = $1', [mailbox]);
    return rows[0] ? { uidValidity: Number(rows[0].uid_validity), lastUid: Number(rows[0].last_uid) } : null;
  }

  async saveCursor(mailbox: string, uidValidity: number, lastUid: number, error: string | null): Promise<void> {
    await this.pool.query(
      `insert into mail_cursors (mailbox, uid_validity, last_uid, error) values ($1, $2, $3, $4)
       on conflict (mailbox) do update set uid_validity = excluded.uid_validity, last_uid = excluded.last_uid, error = excluded.error, polled_at = now()`,
      [mailbox, uidValidity, lastUid, error],
    );
  }

  async cursorStatus(): Promise<{ mailbox: string; polledAt: string; error?: string; lastUid: number }[]> {
    const { rows } = await this.pool.query('select * from mail_cursors order by mailbox');
    return rows.map((r) => ({ mailbox: r.mailbox, polledAt: iso(r.polled_at)!, lastUid: Number(r.last_uid), ...(r.error ? { error: r.error } : {}) }));
  }
}
