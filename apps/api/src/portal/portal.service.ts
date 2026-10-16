import {
  BadRequestException, ConflictException, HttpException, HttpStatus, Inject, Injectable, Logger, NotFoundException, type OnApplicationBootstrap, type OnApplicationShutdown,
} from '@nestjs/common';
import type { DocumentType, Evidence } from '@doccheck/schemas';
import { createHash, randomUUID } from 'node:crypto';
import { isDemo } from '../demo/demo-mode';
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS, MAX_ATTACHMENTS_BYTES, addressOf, messageIdDomain } from '../messaging/mail.config';
import { MailRepository } from '../messaging/mail.repository';
import { MailService } from '../messaging/mail.service';
import { ShipmentsService } from '../shipments/shipments.service';
import { STORAGE, type ObjectStorage } from '../storage/storage';
import type { NewPreShipmentDto, RequestsQuery } from './portal.dto';
import { PortalRepository, type PortalDocumentMeta } from './portal.repository';
import { insertLink, openPortalRequest } from './portal-links';
import { hashMatches, linkToken, portalPath, portalUrl, verifyToken } from './portal-token';
import type {
  PortalEventView, PortalFinding, PortalKind, PortalLinkRow, PortalRequestDetail, PortalRequestRow, PortalRequestSummary, PortalStatus, PortalView,
} from './portal.types';

/** Refused accesses that matched no request are kept this long (for abuse checks only). */
const DENIED_RETENTION_DAYS = 30;

/** Ids the validation gives documents sent as JSON instead of an upload. */
const SLOT_TYPES: Record<string, DocumentType> = { invoice: 'COMMERCIAL_INVOICE', 'packing-list': 'PACKING_LIST', 'bill-of-lading': 'BILL_OF_LADING', isf: 'ISF', stored: 'ISF' };

/** Who is on the other side of a portal call: the link it came with and its request. */
export interface PortalAccess {
  link: PortalLinkRow;
  request: PortalRequestRow;
  ip: string;
  userAgent: string;
}

export interface PortalFile {
  originalname: string;
  buffer: Buffer;
  size: number;
}

/** The status of a request, from its row (see PortalStatus). */
export function statusOf(r: PortalRequestRow): PortalStatus {
  if (r.closedAt) return 'closed';
  if (r.pending > 0) return 'checking';
  if (r.lastUploadStatus === 'failed') return 'failed';
  if (r.uploads === 0) {
    // A correction can be settled without the portal (by email, or fixed by hand) once validated again.
    return r.kind === 'correction' && r.validatedSince && r.open === 0 ? 'clean' : 'waiting';
  }
  return r.open > 0 ? 'open' : 'clean';
}

/**
 * The supplier portal (docs/PORTAL.md): links an importer makes for one request, what a supplier sees
 * and uploads with one, and the check of each upload once its documents are extracted.
 */
@Injectable()
export class PortalService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(PortalService.name);
  private timer?: NodeJS.Timeout;
  private pruner?: NodeJS.Timeout;
  private running?: Promise<void>;

  constructor(
    private readonly repo: PortalRepository,
    private readonly mailRepo: MailRepository,
    private readonly mail: MailService,
    private readonly shipments: ShipmentsService,
    @Inject(STORAGE) private readonly storage: ObjectStorage,
  ) {}

  onApplicationBootstrap() {
    if (isDemo()) return;
    const every = Math.max(300, Number(process.env.PORTAL_CHECK_MS ?? process.env.MAIL_INTAKE_MS ?? 3000) || 3000);
    void this.repo.recoverUploads().catch(() => undefined);
    this.timer = setInterval(() => void this.kick(), every);
    const prune = () => void this.repo.pruneDenied(DENIED_RETENTION_DAYS).catch(() => undefined);
    prune();
    this.pruner = setInterval(prune, 6 * 3600_000);
  }

  async onApplicationShutdown() {
    clearInterval(this.timer);
    clearInterval(this.pruner);
    await this.running;
  }

  // Importer ----------------------------------------------------------------------------------------

  async list(userId: string, q: RequestsQuery) {
    const { items, total } = await this.repo.listRequests(userId, q);
    const summaries = await Promise.all(items.map((r) => this.summary(r)));
    return { items: summaries, total, limit: q.limit, offset: q.offset };
  }

  async detail(userId: string, id: string): Promise<PortalRequestDetail> {
    const r = await this.own(userId, id);
    const [summary, links, events] = await Promise.all([this.summary(r), this.repo.links(id), this.repo.events(id)]);
    return {
      ...summary,
      links: links.map((l) => ({
        id: l.id,
        active: !l.revokedAt && new Date(l.expiresAt).getTime() > Date.now() && !r.closedAt,
        expiresAt: l.expiresAt,
        ...(l.revokedAt ? { revokedAt: l.revokedAt } : {}),
        ...(l.lastUsedAt ? { lastUsedAt: l.lastUsedAt } : {}),
        createdAt: l.createdAt,
      })),
      events: events.map((e): PortalEventView => ({
        kind: e.kind,
        ...(typeof e.detail.reason === 'string' ? { reason: e.detail.reason } : {}),
        ...(Array.isArray(e.detail.files) ? { files: (e.detail.files as { name: string }[]).map((f) => f.name) } : {}),
        ...(typeof e.detail.findings === 'number' ? { findings: e.detail.findings } : {}),
        ...(e.kind === 'opened' ? { count: e.count } : {}),
        ...(e.ip ? { ip: e.ip } : {}),
        createdAt: e.createdAt,
      })),
    };
  }

  /** The link that works now, to copy (the same link every time until it is revoked or expires). */
  async currentLink(userId: string, id: string) {
    await this.own(userId, id);
    const link = await this.repo.activeLink(id);
    if (!link) throw new NotFoundException('This request has no working link: make a new one');
    return this.linkOut(link);
  }

  /** A new link; the ones before it stop working. */
  async newLink(userId: string, id: string, days?: number) {
    const r = await this.own(userId, id);
    if (r.closedAt) throw new BadRequestException('The request is closed: reopen it first');
    const linkId = await this.repo.transaction(async (db) => {
      for (const revoked of await this.repo.revoke(id, undefined, db)) await this.repo.event({ id: randomUUID(), requestId: id, linkId: revoked, kind: 'link_revoked', detail: { reason: 'replaced' } }, db);
      return insertLink(this.repo, db, id, userId, days);
    });
    return this.linkOut((await this.repo.link(linkId))!);
  }

  async revoke(userId: string, id: string, linkId?: string) {
    await this.own(userId, id);
    for (const revoked of await this.repo.revoke(id, linkId)) await this.repo.event({ id: randomUUID(), requestId: id, linkId: revoked, kind: 'link_revoked', detail: { reason: 'revoked' } });
    return this.detail(userId, id);
  }

  async close(userId: string, id: string, closed: boolean) {
    await this.own(userId, id);
    await this.repo.close(id, closed);
    return this.detail(userId, id);
  }

  /** A portal for a correction request sent before links existed (or without one). */
  async forThread(userId: string, threadId: string, days?: number) {
    const thread = await this.mailRepo.findThread(threadId);
    if (!thread || thread.userId !== userId) throw new NotFoundException('Conversation not found');
    if (thread.kind !== 'correction_request' || !thread.shipmentId) throw new BadRequestException('Only a correction request about a shipment can have a portal link');
    const existing = (await this.repo.listRequests(userId, { threadId, limit: 1, offset: 0 })).items[0];
    if (existing) return this.detail(userId, existing.id);
    const { requestId } = await this.repo.transaction((db) =>
      openPortalRequest(this.repo, db, {
        userId,
        kind: 'correction',
        shipmentId: thread.shipmentId!,
        partyId: thread.partyId,
        threadId,
        language: thread.language ?? undefined,
        fingerprints: thread.fingerprints,
        days,
      }),
    );
    return this.detail(userId, requestId);
  }

  /**
   * A pre-shipment check: a draft shipment for the supplier's documents, and a conversation whose first
   * email carries the link.
   */
  async createPreShipment(userId: string, admin: boolean, dto: NewPreShipmentDto): Promise<PortalRequestDetail> {
    const shipment = await this.shipments.create({ reference: `${dto.reference} (pre-shipment)`, destination: dto.destination }, userId);
    let thread;
    try {
      thread = await this.mail.createThread(
        userId,
        { kind: 'conversation', shipmentId: shipment.id, partyId: dto.partyId, to: dto.to, cc: dto.cc, subject: dto.subject, body: dto.body, language: dto.language, fingerprints: [], portal: false },
        admin,
        { kind: 'pre_shipment', reference: dto.reference, supplierName: dto.partyId ? undefined : dto.supplierName, days: dto.days },
      );
    } catch (err) {
      await this.shipments.remove(shipment.id).catch(() => undefined);
      throw err;
    }
    const request = (await this.repo.listRequests(userId, { threadId: thread.id, limit: 1, offset: 0 })).items[0]!;
    return this.detail(userId, request.id);
  }

  private async own(userId: string, id: string): Promise<PortalRequestRow> {
    const r = /^[0-9a-f-]{36}$/i.test(id) ? await this.repo.request(id) : null;
    if (!r || r.userId !== userId) throw new NotFoundException('Portal request not found');
    return r;
  }

  private linkOut(link: PortalLinkRow) {
    const token = linkToken(link.id);
    return { id: link.id, url: portalUrl(token), path: portalPath(token), expiresAt: link.expiresAt };
  }

  private async summary(r: PortalRequestRow): Promise<PortalRequestSummary> {
    const link = r.closedAt ? null : await this.repo.activeLink(r.id);
    return {
      id: r.id,
      kind: r.kind,
      status: statusOf(r),
      shipmentId: r.shipmentId,
      ...(r.shipmentReference ? { shipmentReference: r.shipmentReference } : {}),
      ...(r.reference ? { reference: r.reference } : {}),
      ...(r.partyId ? { partyId: r.partyId } : {}),
      ...(r.supplierName ? { supplier: r.supplierName } : {}),
      ...(r.threadId ? { threadId: r.threadId } : {}),
      ...(r.language ? { language: r.language } : {}),
      open: r.open,
      uploads: r.uploads,
      ...(link ? { linkExpiresAt: link.expiresAt } : {}),
      ...(r.lastActivityAt ? { lastActivityAt: r.lastActivityAt } : {}),
      createdAt: r.createdAt,
      ...(r.closedAt ? { closedAt: r.closedAt } : {}),
    };
  }

  // Supplier ----------------------------------------------------------------------------------------

  /**
   * The request a token opens. Every refusal is recorded; a token that is not signed by this server,
   * or matches no link, is a 404 whatever the reason, so guessing learns nothing.
   */
  async authenticate(token: unknown, ip: string, userAgent: string): Promise<PortalAccess> {
    const deny = async (requestId: string | null, linkId: string | null, reason: string) => {
      await this.repo.event({ id: randomUUID(), requestId, linkId, kind: 'denied', ip, userAgent, detail: { reason } }).catch(() => undefined);
    };
    const linkId = verifyToken(token);
    const link = linkId ? await this.repo.link(linkId) : null;
    if (!link || !hashMatches(link.tokenHash, token as string)) {
      await deny(null, null, linkId ? 'unknown' : 'invalid');
      throw new HttpException({ statusCode: 404, message: 'This link is not valid', reason: 'invalid' }, HttpStatus.NOT_FOUND);
    }
    const request = (await this.repo.request(link.requestId))!;
    const reason = request.closedAt ? 'closed' : link.revokedAt ? 'revoked' : new Date(link.expiresAt).getTime() <= Date.now() ? 'expired' : null;
    if (reason) {
      await deny(request.id, link.id, reason);
      throw new HttpException({ statusCode: 410, message: `This link is ${reason === 'closed' ? 'for a closed request' : reason}`, reason }, HttpStatus.GONE);
    }
    await this.repo.touchLink(link.id);
    return { link, request, ip, userAgent };
  }

  /** The portal page: the request's findings as the supplier may see them, uploads, and earlier requests. */
  async view(access: PortalAccess, record = true): Promise<PortalView> {
    const { request: r, link } = access;
    if (record) await this.repo.event({ id: randomUUID(), requestId: r.id, linkId: link.id, kind: 'opened', ip: access.ip, userAgent: access.userAgent });
    const [importer, latest, uploads, uploaded, docs, history] = await Promise.all([
      this.repo.importerName(r.userId),
      this.repo.latestValidation(r.shipmentId),
      this.repo.uploads(r.id),
      this.repo.uploadedDocuments(r.id),
      this.repo.documents(r.shipmentId),
      r.partyId ? this.repo.history(r.userId, r.partyId) : Promise.resolve([r]),
    ]);
    const findings: PortalFinding[] = [];
    // A pre-shipment draft has nothing to check until the supplier uploads something.
    const current = latest && (r.kind === 'correction' || r.uploads > 0) ? await this.repo.findingsOf(latest.id) : [];
    const cites = (f: Record<string, unknown>) => (f.evidence as Evidence[]).some((ev) => uploaded.has(ev.documentId));
    for (const f of current) {
      if (r.kind === 'pre_shipment' || r.fingerprints.includes(f.fingerprint) || cites(f)) findings.push(this.supplierFinding(f, 'open', docs, r.partyId, uploaded));
    }
    if (r.kind === 'correction') {
      const present = new Set(current.map((f) => f.fingerprint as string));
      const gone = r.fingerprints.filter((fp) => !present.has(fp));
      for (const f of await this.repo.findingsByFingerprint(r.shipmentId, gone)) findings.push(this.supplierFinding(f, 'fixed', docs, r.partyId, uploaded));
    }
    return {
      kind: r.kind,
      status: statusOf(r),
      ...((r.reference ?? r.shipmentReference) ? { reference: r.reference ?? r.shipmentReference } : {}),
      ...(r.destination ? { destination: r.destination } : {}),
      importer,
      ...(r.supplierName ? { supplier: r.supplierName } : {}),
      ...(r.language ? { language: r.language } : {}),
      expiresAt: link.expiresAt,
      findings,
      skipped: r.kind === 'pre_shipment' && latest && r.uploads > 0 ? latest.skipped : [],
      ...(latest && (r.kind === 'correction' || r.uploads > 0) ? { validatedAt: latest.createdAt } : {}),
      uploads,
      history: history.map((h) => ({ kind: h.kind, ...((h.reference ?? h.shipmentReference) ? { reference: h.reference ?? h.shipmentReference } : {}), status: statusOf(h), createdAt: h.createdAt, current: h.id === r.id })),
      limits: { maxFileBytes: MAX_ATTACHMENT_BYTES, maxFiles: MAX_ATTACHMENTS, maxTotalBytes: MAX_ATTACHMENTS_BYTES },
    };
  }

  /**
   * A finding as a supplier sees it: the rule, its values and pages, and the regulation; never the
   * agent's reasoning, the importer's notes or document ids. A value from an invoice or packing list of
   * another company of the importer is left out.
   */
  private supplierFinding(f: Record<string, unknown>, state: PortalFinding['state'], docs: Map<string, PortalDocumentMeta>, partyId: string | undefined, uploaded: Set<string>): PortalFinding {
    const evidence = (f.evidence as Evidence[]).flatMap((ev) => {
      const doc = docs.get(ev.documentId);
      if (doc?.sellerId && partyId && doc.sellerId !== partyId && !uploaded.has(doc.id)) return [];
      const documentType: DocumentType = doc?.type ?? SLOT_TYPES[ev.documentId] ?? 'UNKNOWN';
      return [{ documentType, field: ev.field, value: ev.value, ...(ev.source?.page ? { page: ev.source.page } : {}) }];
    });
    const regulation = f.regulation as { title?: string; url?: string } | null;
    return {
      fingerprint: f.fingerprint as string,
      ruleId: f.rule_id as string,
      severity: f.severity as PortalFinding['severity'],
      state,
      message: f.message as string,
      evidence,
      ...(regulation?.title && regulation.url ? { regulation: { title: regulation.title, url: regulation.url } } : {}),
    };
  }

  /**
   * Corrected or draft PDFs from the supplier. They arrive as a received message of the request's
   * conversation, with the files as its attachments (as replies by email do), go into the shipment as
   * documents, and are checked once extracted.
   */
  async upload(access: PortalAccess, files: PortalFile[], note: string | undefined): Promise<PortalView> {
    const { request: r, link } = access;
    const refuse = async (reason: string, message: string) => {
      await this.repo.event({ id: randomUUID(), requestId: r.id, linkId: link.id, kind: 'upload_refused', ip: access.ip, userAgent: access.userAgent, detail: { reason, files: files.map((f) => ({ name: cleanName(f.originalname), size: f.size })) } });
      throw new BadRequestException(message);
    };
    if (files.length === 0) throw new BadRequestException('Send at least one PDF in the "files" field');
    if (files.length > MAX_ATTACHMENTS) await refuse('too_many', `At most ${MAX_ATTACHMENTS} files at once`);
    if (files.reduce((n, f) => n + f.size, 0) > MAX_ATTACHMENTS_BYTES) await refuse('too_large', `At most ${MAX_ATTACHMENTS_BYTES / 1024 / 1024} MB at once`);
    for (const f of files) {
      if (f.size > MAX_ATTACHMENT_BYTES) await refuse('too_large', `${cleanName(f.originalname)} is larger than ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB`);
      // The bytes decide, not the name or the type the browser says.
      if (!f.buffer.subarray(0, 5).toString('latin1').startsWith('%PDF')) await refuse('not_pdf', `${cleanName(f.originalname)} is not a PDF`);
    }
    const shipment = await this.shipments.get(r.shipmentId);
    if (!shipment.destination) throw new ConflictException('The shipment has no destination yet; ask the importer');

    const messageId = r.threadId ? randomUUID() : null;
    const named = files.map((f) => ({ ...f, name: cleanName(f.originalname) }));
    if (r.threadId && messageId) {
      const thread = (await this.mailRepo.findThread(r.threadId))!;
      const items = await this.mailRepo.messages(r.threadId);
      // Answers go where the link was emailed: the person holding it got it there.
      const recipient = items.find((m) => m.direction === 'out')?.to[0];
      const label = `${(r.supplierName ?? 'Supplier').replace(/["<>\r\n]/g, '').slice(0, 120)} (portal)`;
      await this.mailRepo.insertMessage({
        id: messageId,
        threadId: r.threadId,
        userId: null,
        direction: 'in',
        status: 'received',
        from: recipient ? `${label} <${addressOf(recipient)}>` : label,
        to: [],
        cc: [],
        subject: /^re:/i.test(thread.subject) ? thread.subject : `Re: ${thread.subject}`,
        text: (note ?? '').replace(/\u0000/g, ''),
        messageId: `portal-${messageId}@${messageIdDomain()}`,
        inReplyTo: null,
        references: [],
        receivedAt: new Date().toISOString(),
        senderCheck: 'none',
      });
    }
    const attachmentIds: string[] = [];
    if (messageId) {
      for (const f of named) {
        const attachmentId = randomUUID();
        const key = `mail/${messageId}/${attachmentId}`;
        await this.storage.put(key, f.buffer, 'application/pdf');
        await this.mailRepo.insertAttachment({ id: attachmentId, messageId, filename: f.name, contentType: 'application/pdf', size: f.size, storageKey: key });
        attachmentIds.push(attachmentId);
      }
    }
    const { documents } = await this.shipments.addDocuments(r.shipmentId, named.map((f) => ({ name: f.name, bytes: f.buffer })));
    const documentIds = documents.map((d) => ('document' in d ? (d as { document: { id: string } }).document.id : (d as { id: string }).id));
    for (const [i, attachmentId] of attachmentIds.entries()) await this.mailRepo.linkAttachment(attachmentId, documentIds[i]!);
    await this.repo.insertUpload({ id: randomUUID(), requestId: r.id, messageId, documentIds });
    await this.repo.event({
      id: randomUUID(),
      requestId: r.id,
      linkId: link.id,
      kind: 'uploaded',
      ip: access.ip,
      userAgent: access.userAgent,
      detail: { files: named.map((f) => ({ name: f.name, size: f.size, sha256: createHash('sha256').update(f.buffer).digest('hex') })), ...(note ? { note: true } : {}) },
    });
    if (r.threadId) await this.mailRepo.touchThreadIn(r.threadId);
    this.logger.log(`Portal: ${files.length} PDF(s) for request ${r.id}`);
    void this.kick();
    return this.view({ ...access, request: (await this.repo.request(r.id))! }, false);
  }

  // Checking uploads ---------------------------------------------------------------------------------

  kick(): Promise<void> {
    this.running ??= this.drain()
      .catch((err) => this.logger.error(`Portal: ${err instanceof Error ? err.message : err}`))
      .finally(() => (this.running = undefined));
    return this.running;
  }

  /** Uploads whose documents are all extracted: the shipment is validated, and the supplier sees the result. */
  private async drain() {
    for (;;) {
      const job = await this.repo.claimUpload();
      if (!job) return;
      try {
        await this.shipments.validate(job.shipmentId, {}, {});
        const open = (await this.repo.request(job.requestId))?.open ?? 0;
        await this.repo.finishUpload(job.id, 'validated', { findings: open });
        await this.repo.event({ id: randomUUID(), requestId: job.requestId, linkId: null, kind: 'checked', detail: { findings: open } });
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        await this.repo.finishUpload(job.id, 'failed', { error });
        await this.repo.event({ id: randomUUID(), requestId: job.requestId, linkId: null, kind: 'checked', detail: { error: error.slice(0, 300) } });
        this.logger.warn(`Portal upload ${job.id} could not be checked: ${error}`);
      }
    }
  }
}

/** A file name safe to store and show. */
function cleanName(name: string): string {
  return (name || 'document.pdf').replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 200);
}
