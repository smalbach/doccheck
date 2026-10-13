import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { FindingReviewsRepository } from '../shipments/reviews.repository';
import { ShipmentsRepository } from '../shipments/shipments.repository';
import { ShipmentsService } from '../shipments/shipments.service';
import { STORAGE, type ObjectStorage } from '../storage/storage';
import { ImapPoller } from './imap.poller';
import type { PoolClient } from 'pg';
import { addressOf, adminsOnly, followUpDays, mailFrom, messageIdDomain, replyAddress, SEND_LIMITS } from './mail.config';
import type { NewThreadDto, ReplyDto, ThreadsQuery } from './mail.dto';
import { MailRepository } from './mail.repository';
import { MailTransport } from './mail-transport';
import type { ThreadDetail } from './mail.types';
import { OutboxWorker } from './outbox.worker';

const EMAIL = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;

const newToken = () => {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  return [...randomBytes(8)].map((b) => alphabet[b % alphabet.length]).join('');
};
const newMessageId = () => `${randomUUID()}@${messageIdDomain()}`;
const dueDate = () => new Date(Date.now() + followUpDays() * 86_400_000).toISOString();

@Injectable()
export class MailService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly repo: MailRepository,
    private readonly outbox: OutboxWorker,
    private readonly transport: MailTransport,
    private readonly shipments: ShipmentsService,
    private readonly shipmentsRepo: ShipmentsRepository,
    private readonly reviews: FindingReviewsRepository,
    @Inject(STORAGE) private readonly storage: ObjectStorage,
  ) {}

  /** Starts a conversation, or a request for corrected documents, and queues its first message. */
  async createThread(userId: string, dto: NewThreadDto, admin = false): Promise<ThreadDetail> {
    if (dto.shipmentId) await this.ownShipment(userId, dto.shipmentId);
    const partyId = dto.partyId ?? (dto.shipmentId ? await this.sellerOf(dto.shipmentId) : undefined);
    if (dto.partyId) await this.ownParty(userId, dto.partyId);
    let findings: { fingerprint: string; ruleId: string }[] = [];
    if (dto.fingerprints.length) {
      const latest = await this.shipmentsRepo.latestFindings(dto.shipmentId!);
      const byFingerprint = new Map(latest.map((f) => [f.fingerprint, f.ruleId]));
      const unknown = dto.fingerprints.filter((fp) => !byFingerprint.has(fp));
      if (unknown.length) throw new BadRequestException(`Not findings of the latest validation: ${unknown.join(', ')}`);
      findings = [...new Set(dto.fingerprints)].map((fingerprint) => ({ fingerprint, ruleId: byFingerprint.get(fingerprint)! }));
    }
    const threadId = randomUUID();
    const token = newToken();
    await this.repo.transaction(async (db) => {
      await this.reserve(db, userId, admin);
      await this.repo.insertThread(
        { id: threadId, userId, shipmentId: dto.shipmentId, partyId, token, kind: dto.kind, subject: dto.subject, status: 'awaiting', language: dto.language, fingerprints: findings.map((f) => f.fingerprint), dueAt: dueDate() },
        db,
      );
      await this.repo.insertMessage(
        { id: randomUUID(), threadId, userId, direction: 'out', status: 'queued', from: mailFrom(), to: dto.to, cc: dto.cc, subject: dto.subject, text: dto.body, messageId: newMessageId(), inReplyTo: null, references: [] },
        db,
      );
    });
    await this.repo.saveContacts(userId, partyId, [...dto.to, ...dto.cc]);
    if (findings.length) await this.reviews.save(dto.shipmentId!, userId, findings, 'waiting_supplier', `→ ${dto.to.join(', ')}`);
    void this.outbox.kick();
    return this.thread(userId, threadId);
  }

  /** Answers in a thread: to whoever wrote last unless `to` says otherwise, threaded by headers. */
  async reply(userId: string, threadId: string, dto: ReplyDto, admin = false): Promise<ThreadDetail> {
    const thread = await this.ownThread(userId, threadId);
    const messages = await this.repo.messages(threadId);
    const last = messages.at(-1);
    const lastIn = [...messages].reverse().find((m) => m.direction === 'in');
    const firstOut = messages.find((m) => m.direction === 'out');
    // By default, the address the last reply came from (never the From text, which can list others).
    const to = dto.to ?? (lastIn ? [addressOf(lastIn.from)] : (firstOut?.to ?? []));
    if (to.length === 0 || !to.every((a) => EMAIL.test(a))) throw new BadRequestException('Say who to write to');
    const { rows } = await this.pool.query<{ message_id: string | null; references: string[] }>(
      'select message_id, "references" from mail_messages where id = $1',
      [last?.id ?? null],
    );
    const parent = rows[0];
    const references = parent?.message_id ? [...(parent.references ?? []), parent.message_id].slice(-20) : [];
    await this.repo.transaction(async (db) => {
      await this.reserve(db, userId, admin);
      await this.repo.insertMessage(
        {
          id: randomUUID(),
          threadId,
          userId,
          direction: 'out',
          status: 'queued',
          from: mailFrom(),
          to: to.map((a) => a.toLowerCase()),
          cc: dto.cc ?? firstOut?.cc ?? [],
          subject: /^re:/i.test(thread.subject) ? thread.subject : `Re: ${thread.subject}`,
          text: dto.body,
          messageId: newMessageId(),
          inReplyTo: parent?.message_id ?? null,
          references,
        },
        db,
      );
      await this.repo.touchThreadOut(threadId, dueDate(), db);
    });
    await this.repo.markRead(threadId);
    void this.outbox.kick();
    return this.thread(userId, threadId);
  }

  async thread(userId: string, threadId: string): Promise<ThreadDetail> {
    const thread = await this.ownThread(userId, threadId);
    const fresh = (await this.repo.findThread(threadId))!;
    const items = await this.repo.messages(threadId);
    return { ...fresh.summary, ...(thread.language ? { language: thread.language } : {}), replyTo: replyAddress(thread.token), fingerprints: thread.fingerprints, items };
  }

  list(userId: string, q: ThreadsQuery) {
    return this.repo.listThreads(userId, q).then((r) => ({ ...r, limit: q.limit, offset: q.offset }));
  }

  async markRead(userId: string, threadId: string) {
    await this.ownThread(userId, threadId);
    await this.repo.markRead(threadId);
    return this.thread(userId, threadId);
  }

  async setStatus(userId: string, threadId: string, status: 'awaiting' | 'closed') {
    await this.ownThread(userId, threadId);
    await this.repo.setStatus(threadId, status);
    return this.thread(userId, threadId);
  }

  async retry(userId: string, messageId: string, admin = false) {
    const message = await this.repo.messageById(messageId);
    if (!message || message.threadUserId !== userId) throw new NotFoundException('Message not found');
    if (message.status !== 'failed') throw new BadRequestException('Only a failed message can be sent again');
    // Sending again counts like sending: the limits apply.
    await this.repo.transaction((db) => this.reserve(db, userId, admin));
    if (!(await this.repo.requeue(messageId))) throw new BadRequestException('Only a failed message can be sent again');
    void this.outbox.kick();
    return this.thread(userId, message.threadId!);
  }

  summary(userId: string, admin: boolean) {
    return this.repo.summary(userId, admin);
  }

  contacts(userId: string, partyId?: string) {
    return this.repo.contacts(userId, partyId);
  }

  /** Everyone learns whether mail is really delivered; admins also see the queue and the mailboxes. */
  async status(admin: boolean) {
    if (!admin) return { sending: this.transport.mode };
    const { rows: [queue] } = await this.pool.query(
      `select (count(*) filter (where status in ('queued', 'sending')))::int as queued, (count(*) filter (where status = 'failed'))::int as failed from mail_messages where direction = 'out'`,
    );
    return {
      sending: this.transport.mode,
      from: mailFrom(),
      replyTo: replyAddress('token').replace('+token', '+…'),
      receiving: { imap: ImapPoller.configured(), webhook: !!process.env.MAIL_INBOUND_SECRET, mailboxes: await this.repo.cursorStatus() },
      queue,
      followUpDays: followUpDays(),
    };
  }

  /** A received attachment's bytes, for its owner (or an admin, while unassigned). */
  async attachmentFile(userId: string, admin: boolean, attachmentId: string) {
    const a = await this.repo.attachment(attachmentId);
    if (!a || !(a.userId === userId || (admin && !a.threadId))) throw new NotFoundException('Attachment not found');
    return { name: a.filename, contentType: a.contentType, bytes: await this.storage.get(a.storageKey) };
  }

  /** Adds a received PDF to the thread's shipment as a document, which extracts as any upload. */
  async importAttachment(userId: string, attachmentId: string) {
    const a = await this.repo.attachment(attachmentId);
    if (!a || a.userId !== userId) throw new NotFoundException('Attachment not found');
    if (a.documentId) throw new BadRequestException('This attachment is already in the shipment');
    const thread = (await this.repo.findThread(a.threadId!))!;
    if (!thread.shipmentId) throw new BadRequestException('The conversation is not about a shipment');
    if (a.contentType !== 'application/pdf') throw new BadRequestException('Only PDF attachments can be added as documents');
    const bytes = await this.storage.get(a.storageKey);
    const { documents } = await this.shipments.addDocuments(thread.shipmentId, [{ name: a.filename, bytes }]);
    const added = documents[0]!;
    const documentId = 'document' in added ? added.document.id : added.id;
    await this.repo.linkAttachment(attachmentId, documentId);
    return { shipmentId: thread.shipmentId, documentId };
  }

  /** Received mail no thread claimed (admins). */
  unassigned() {
    return this.repo.messages(null, 100);
  }

  async assign(messageId: string, threadId: string) {
    const message = await this.repo.messageById(messageId);
    if (!message || message.threadId) throw new NotFoundException('Unassigned message not found');
    if (!(await this.repo.findThread(threadId))) throw new NotFoundException('Thread not found');
    await this.repo.assignMessage(messageId, threadId);
    await this.repo.touchThreadIn(threadId);
    return { threadId };
  }

  private async ownThread(userId: string, threadId: string) {
    const thread = await this.repo.findThread(threadId);
    if (!thread || thread.userId !== userId) throw new NotFoundException('Conversation not found');
    return thread;
  }

  private async ownShipment(userId: string, shipmentId: string) {
    const { rows } = await this.pool.query('select user_id from shipments where id = $1', [shipmentId]);
    if (!rows[0] || rows[0].user_id !== userId) throw new NotFoundException(`Shipment ${shipmentId} not found`);
  }

  private async ownParty(userId: string, partyId: string) {
    const { rows } = await this.pool.query('select user_id from parties where id = $1', [partyId]);
    if (!rows[0] || rows[0].user_id !== userId) throw new NotFoundException('Company not found');
  }

  /** The seller on the shipment's current invoice: who a correction request usually goes to. */
  private async sellerOf(shipmentId: string): Promise<string | undefined> {
    const { rows } = await this.pool.query(
      `select i.seller_id from invoices i join current_documents c on c.document_id = i.document_id where i.shipment_id = $1 and i.seller_id is not null limit 1`,
      [shipmentId],
    );
    return rows[0]?.seller_id ?? undefined;
  }

  /**
   * Inside the transaction that queues a message: one at a time per user (advisory lock), so
   * parallel requests cannot all pass the counts; then the hourly and daily limits.
   */
  private async reserve(db: PoolClient, userId: string, admin: boolean) {
    if (adminsOnly() && !admin) throw new ForbiddenException('Only admins can send email on this server');
    await db.query('select pg_advisory_xact_lock(hashtext($1))', [`mail:${userId}`]);
    const limits: [string | null, string, number][] = [
      [userId, '1 hour', SEND_LIMITS.userHour],
      [userId, '1 day', SEND_LIMITS.userDay],
      [null, '1 hour', SEND_LIMITS.serverHour],
    ];
    for (const [who, interval, max] of limits) {
      if ((await this.repo.sentSince(db, who, interval)) >= max) {
        throw new HttpException(`At most ${max} messages per ${interval.replace('1 ', '')}${who ? '' : ' on this server'}`, HttpStatus.TOO_MANY_REQUESTS);
      }
    }
  }

  static badRequest() {
    return new BadRequestException('Send the raw email as the body, or JSON { "raw": "<base64>" }');
  }

  /** Thrown by the inbound webhook when the secret is missing or wrong. */
  static forbidden() {
    return new ForbiddenException('Inbound mail is not enabled, or the secret is wrong');
  }
}
