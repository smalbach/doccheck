import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { AuditService } from '../audit/audit.service';
import { PG_POOL } from '../db/db.module';
import { FindingReviewsRepository } from '../shipments/reviews.repository';
import { ShipmentsRepository } from '../shipments/shipments.repository';
import { ShipmentsService } from '../shipments/shipments.service';
import { STORAGE, type ObjectStorage } from '../storage/storage';
import { ImapPoller } from './imap.poller';
import type { PoolClient } from 'pg';
import { inputFormat } from '@doccheck/extraction';
import { addressOf, adminsOnly, followUpDays, mailFrom, messageIdDomain, replyAddress, SEND_LIMITS } from './mail.config';
import type { NewThreadDto, ReplyDto, ThreadsQuery } from './mail.dto';
import { MailIntakeService } from './mail-intake.service';
import { MailRepository } from './mail.repository';
import { MailTransport } from './mail-transport';
import type { ThreadDetail } from './mail.types';
import { OutboxWorker } from './outbox.worker';
import { PortalRepository } from '../portal/portal.repository';
import { openPortalRequest } from '../portal/portal-links';
import { withLinkLine } from '../portal/portal-text';
import type { PortalKind } from '../portal/portal.types';

const EMAIL = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;

const newToken = () => {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  return [...randomBytes(8)].map((b) => alphabet[b % alphabet.length]).join('');
};
const newMessageId = () => `${randomUUID()}@${messageIdDomain()}`;
const dueDate = () => new Date(Date.now() + followUpDays() * 86_400_000).toISOString();

/** Who acts: the member, and the organization whose conversations they work in. */
export interface MailActor {
  userId: string;
  orgId: string;
}

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
    private readonly intake: MailIntakeService,
    @Inject(STORAGE) private readonly storage: ObjectStorage,
    private readonly audit: AuditService,
    private readonly portal: PortalRepository,
  ) {}

  /**
   * Starts a conversation, or a request for corrected documents, and queues its first message. With a
   * portal (dto.portal on a correction request, or `portal` for a pre-shipment check), the request and
   * its first link are made in the same transaction, and the text gets the link line if it has none.
   */
  async createThread(
    actor: MailActor,
    dto: NewThreadDto,
    admin = false,
    portal?: { kind: PortalKind; reference?: string; supplierName?: string; days?: number },
  ): Promise<ThreadDetail> {
    const { userId, orgId } = actor;
    if (dto.shipmentId) await this.ownShipment(orgId, dto.shipmentId);
    const partyId = dto.partyId ?? (dto.shipmentId ? await this.sellerOf(dto.shipmentId) : undefined);
    if (dto.partyId) await this.ownParty(orgId, dto.partyId);
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
    const withPortal = portal ?? (dto.portal && dto.kind === 'correction_request' ? { kind: 'correction' as const } : undefined);
    const body = withPortal ? withLinkLine(dto.body, withPortal.kind, dto.language) : dto.body;
    let opened: { requestId: string; linkId: string } | undefined;
    await this.repo.transaction(async (db) => {
      await this.reserve(db, userId, admin);
      await this.repo.insertThread(
        { id: threadId, userId, orgId, shipmentId: dto.shipmentId, partyId, token, kind: dto.kind, subject: dto.subject, status: 'awaiting', language: dto.language, fingerprints: findings.map((f) => f.fingerprint), dueAt: dueDate() },
        db,
      );
      await this.repo.insertMessage(
        { id: randomUUID(), threadId, userId, direction: 'out', status: 'queued', from: mailFrom(), to: dto.to, cc: dto.cc, subject: dto.subject, text: body, messageId: newMessageId(), inReplyTo: null, references: [] },
        db,
      );
      if (withPortal && dto.shipmentId) {
        opened = await openPortalRequest(this.portal, db, {
          orgId,
          userId,
          kind: withPortal.kind,
          shipmentId: dto.shipmentId,
          partyId,
          supplierName: withPortal.supplierName,
          threadId,
          reference: withPortal.reference,
          language: dto.language,
          fingerprints: findings.map((f) => f.fingerprint),
          days: withPortal.days,
        });
      }
    });
    if (opened && withPortal) {
      this.audit.note({ orgId, action: 'portal.create', entity: 'portal_request', entityId: opened.requestId, after: { kind: withPortal.kind, threadId, shipmentId: dto.shipmentId, partyId, supplier: withPortal.supplierName, reference: withPortal.reference, linkId: opened.linkId } });
    }
    await this.repo.saveContacts(orgId, userId, partyId, [...dto.to, ...dto.cc]);
    if (findings.length) await this.reviews.save(dto.shipmentId!, userId, findings, 'waiting_supplier', `→ ${dto.to.join(', ')}`);
    void this.outbox.kick();
    return this.thread(actor, threadId);
  }

  /** Answers in a thread: to whoever wrote last unless `to` says otherwise, threaded by headers. */
  async reply(actor: MailActor, threadId: string, dto: ReplyDto, admin = false): Promise<ThreadDetail> {
    const { userId } = actor;
    const thread = await this.ownThread(actor.orgId, threadId);
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
    return this.thread(actor, threadId);
  }

  async thread(actor: MailActor, threadId: string): Promise<ThreadDetail> {
    const thread = await this.ownThread(actor.orgId, threadId);
    const fresh = (await this.repo.findThread(threadId))!;
    const items = await this.repo.messages(threadId);
    const intakes = thread.kind === 'intake' ? await this.intake.forThread(threadId) : undefined;
    return { ...fresh.summary, ...(thread.language ? { language: thread.language } : {}), replyTo: replyAddress(thread.token), fingerprints: thread.fingerprints, items, ...(intakes ? { intakes } : {}) };
  }

  list(actor: MailActor, q: ThreadsQuery) {
    return this.repo.listThreads(actor.orgId, q).then((r) => ({ ...r, limit: q.limit, offset: q.offset }));
  }

  async markRead(actor: MailActor, threadId: string) {
    await this.ownThread(actor.orgId, threadId);
    await this.repo.markRead(threadId);
    return this.thread(actor, threadId);
  }

  async setStatus(actor: MailActor, threadId: string, status: 'awaiting' | 'closed') {
    const thread = await this.ownThread(actor.orgId, threadId);
    await this.repo.setStatus(threadId, status);
    this.audit.note({ action: 'mail.status', entity: 'mail_thread', entityId: threadId, before: { status: thread.status }, after: { status } });
    return this.thread(actor, threadId);
  }

  async retry(actor: MailActor, messageId: string, admin = false) {
    const { userId } = actor;
    const message = await this.repo.messageById(messageId);
    if (!message || message.threadOrgId !== actor.orgId) throw new NotFoundException('Message not found');
    if (message.status !== 'failed') throw new BadRequestException('Only a failed message can be sent again');
    // Sending again counts like sending: the limits apply.
    await this.repo.transaction((db) => this.reserve(db, userId, admin));
    if (!(await this.repo.requeue(messageId))) throw new BadRequestException('Only a failed message can be sent again');
    void this.outbox.kick();
    return this.thread(actor, message.threadId!);
  }

  summary(actor: MailActor, admin: boolean) {
    return this.repo.summary(actor.orgId, admin);
  }

  contacts(actor: MailActor, partyId?: string, shipmentId?: string) {
    return this.repo.contacts(actor.orgId, partyId, shipmentId);
  }

  /** Everyone learns whether mail is really delivered; admins also see the queue and the mailboxes. */
  async status(admin: boolean) {
    // From and reply-to are in every email a user sends, so anyone may see them; the rest is for admins.
    if (!admin) return { sending: this.transport.mode, from: mailFrom(), replyTo: replyAddress('token').replace('+token', '+…') };
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

  /** A received attachment's bytes, for the conversation's organization (or an admin, while unassigned). */
  async attachmentFile(actor: MailActor, admin: boolean, attachmentId: string) {
    const a = await this.repo.attachment(attachmentId);
    if (!a || !(a.orgId === actor.orgId || (admin && !a.threadId))) throw new NotFoundException('Attachment not found');
    return { name: a.filename, contentType: a.contentType, bytes: await this.storage.get(a.storageKey) };
  }

  /** Adds a received PDF, photo or spreadsheet to the thread's shipment as a document, which extracts as any upload. */
  async importAttachment(actor: MailActor, attachmentId: string) {
    const a = await this.repo.attachment(attachmentId);
    if (!a || a.orgId !== actor.orgId) throw new NotFoundException('Attachment not found');
    if (a.documentId) throw new BadRequestException('This attachment is already in the shipment');
    const thread = (await this.repo.findThread(a.threadId!))!;
    if (!thread.shipmentId) throw new BadRequestException('The conversation is not about a shipment');
    const bytes = await this.storage.get(a.storageKey);
    if (!inputFormat(a.filename, new Uint8Array(bytes))) throw new BadRequestException('Only PDF, photo and spreadsheet attachments can be added as documents');
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

  private async ownThread(orgId: string, threadId: string) {
    const thread = await this.repo.findThread(threadId);
    if (!thread || thread.orgId !== orgId) throw new NotFoundException('Conversation not found');
    return thread;
  }

  private async ownShipment(orgId: string, shipmentId: string) {
    const { rows } = await this.pool.query('select org_id from shipments where id = $1', [shipmentId]);
    if (!rows[0] || rows[0].org_id !== orgId) throw new NotFoundException(`Shipment ${shipmentId} not found`);
  }

  private async ownParty(orgId: string, partyId: string) {
    const { rows } = await this.pool.query('select org_id from parties where id = $1', [partyId]);
    if (!rows[0] || rows[0].org_id !== orgId) throw new NotFoundException('Company not found');
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

  static badRequestRetry() {
    return new BadRequestException('Only an intake waiting for a destination, or failed, can be checked again');
  }

  static badRequest() {
    return new BadRequestException('Send the raw email as the body, or JSON { "raw": "<base64>" }');
  }

  /** Thrown by the inbound webhook when the secret is missing or wrong. */
  static forbidden() {
    return new ForbiddenException('Inbound mail is not enabled, or the secret is wrong');
  }
}
