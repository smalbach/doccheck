import {
  BadRequestException, ConflictException, HttpException, HttpStatus, Inject, Injectable, Logger, NotFoundException, type OnApplicationBootstrap, type OnApplicationShutdown,
} from '@nestjs/common';
import type { DocumentFormat, DocumentType, Evidence } from '@doccheck/schemas';
import { inputFormat } from '@doccheck/extraction';
import { createHash, randomUUID } from 'node:crypto';
import { isDemo } from '../demo/demo-mode';
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS, MAX_ATTACHMENTS_BYTES, addressOf, messageIdDomain } from '../messaging/mail.config';
import { MailRepository } from '../messaging/mail.repository';
import { MailService, type MailActor } from '../messaging/mail.service';
import { AuditService } from '../audit/audit.service';
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

/** An opening of the page goes to the audit log at most this often per link and address (the page polls while checking). */
const AUDIT_OPEN_MS = 10 * 60_000;

/**
 * Rules that compare with the organization's records (earlier invoices, prices, purchase orders): a
 * pre-shipment draft is checked without them (RuleSettingsService), so the supplier sees them as left
 * for later, like the rules that need the B/L.
 */
const HISTORY_RULES = ['X17', 'X23', 'X24'];

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
  private readonly auditedOpens = new Map<string, number>();

  constructor(
    private readonly repo: PortalRepository,
    private readonly mailRepo: MailRepository,
    private readonly mail: MailService,
    private readonly shipments: ShipmentsService,
    @Inject(STORAGE) private readonly storage: ObjectStorage,
    private readonly audit: AuditService,
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

  async list(actor: MailActor, q: RequestsQuery) {
    const { items, total } = await this.repo.listRequests(actor.orgId, q);
    const summaries = await Promise.all(items.map((r) => this.summary(r)));
    return { items: summaries, total, limit: q.limit, offset: q.offset };
  }

  async detail(actor: MailActor, id: string): Promise<PortalRequestDetail> {
    const r = await this.own(actor, id);
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
  async currentLink(actor: MailActor, id: string) {
    await this.own(actor, id);
    const link = await this.repo.activeLink(id);
    if (!link) throw new NotFoundException('This request has no working link: make a new one');
    return this.linkOut(link);
  }

  /** A new link; the ones before it stop working. */
  async newLink(actor: MailActor, id: string, days?: number) {
    const r = await this.own(actor, id);
    if (r.closedAt) throw new BadRequestException('The request is closed: reopen it first');
    const { linkId, revoked } = await this.repo.transaction(async (db) => {
      const revoked = await this.repo.revoke(id, undefined, db);
      for (const old of revoked) await this.repo.event({ id: randomUUID(), requestId: id, linkId: old, kind: 'link_revoked', detail: { reason: 'replaced' } }, db);
      return { linkId: await insertLink(this.repo, db, id, actor.userId, days), revoked };
    });
    const link = (await this.repo.link(linkId))!;
    this.audit.note({ orgId: r.orgId, action: 'portal.link_create', entity: 'portal_request', entityId: id, after: { linkId, expiresAt: link.expiresAt, replaced: revoked } });
    return this.linkOut(link);
  }

  async revoke(actor: MailActor, id: string, linkId?: string) {
    const r = await this.own(actor, id);
    const revoked = await this.repo.revoke(id, linkId);
    for (const old of revoked) await this.repo.event({ id: randomUUID(), requestId: id, linkId: old, kind: 'link_revoked', detail: { reason: 'revoked' } });
    this.audit.note({ orgId: r.orgId, action: 'portal.link_revoke', entity: 'portal_request', entityId: id, after: { revoked } });
    return this.detail(actor, id);
  }

  async close(actor: MailActor, id: string, closed: boolean) {
    const r = await this.own(actor, id);
    await this.repo.close(id, closed);
    this.audit.note({ orgId: r.orgId, action: closed ? 'portal.close' : 'portal.reopen', entity: 'portal_request', entityId: id, before: { closed: !!r.closedAt }, after: { closed } });
    return this.detail(actor, id);
  }

  /** A portal for a correction request sent before links existed (or without one). */
  async forThread(actor: MailActor, threadId: string, days?: number) {
    const thread = await this.mailRepo.findThread(threadId);
    if (!thread || thread.orgId !== actor.orgId) throw new NotFoundException('Conversation not found');
    if (thread.kind !== 'correction_request' || !thread.shipmentId) throw new BadRequestException('Only a correction request about a shipment can have a portal link');
    const existing = (await this.repo.listRequests(actor.orgId, { threadId, limit: 1, offset: 0 })).items[0];
    if (existing) return this.detail(actor, existing.id);
    const { requestId, linkId } = await this.repo.transaction((db) =>
      openPortalRequest(this.repo, db, {
        orgId: actor.orgId,
        userId: actor.userId,
        kind: 'correction',
        shipmentId: thread.shipmentId!,
        partyId: thread.partyId,
        threadId,
        language: thread.language ?? undefined,
        fingerprints: thread.fingerprints,
        days,
      }),
    );
    this.audit.note({ orgId: actor.orgId, action: 'portal.create', entity: 'portal_request', entityId: requestId, after: { kind: 'correction', threadId, linkId } });
    return this.detail(actor, requestId);
  }

  /**
   * A pre-shipment check: a draft shipment for the supplier's documents in the organization, and a
   * conversation whose first email carries the link.
   */
  async createPreShipment(actor: MailActor, admin: boolean, dto: NewPreShipmentDto): Promise<PortalRequestDetail> {
    const shipment = await this.shipments.create({ reference: `${dto.reference} (pre-shipment)`, destination: dto.destination }, actor.userId, actor.orgId);
    let thread;
    try {
      thread = await this.mail.createThread(
        actor,
        { kind: 'conversation', shipmentId: shipment.id, partyId: dto.partyId, to: dto.to, cc: dto.cc, subject: dto.subject, body: dto.body, language: dto.language, fingerprints: [], portal: false },
        admin,
        { kind: 'pre_shipment', reference: dto.reference, supplierName: dto.partyId ? undefined : dto.supplierName, days: dto.days },
      );
    } catch (err) {
      await this.shipments.remove(shipment.id).catch(() => undefined);
      throw err;
    }
    const request = (await this.repo.listRequests(actor.orgId, { threadId: thread.id, limit: 1, offset: 0 })).items[0]!;
    return this.detail(actor, request.id);
  }

  /** A request of the actor's organization; any other answers 404, the same as one that does not exist. */
  private async own(actor: MailActor, id: string): Promise<PortalRequestRow> {
    const r = /^[0-9a-f-]{36}$/i.test(id) ? await this.repo.request(id) : null;
    if (!r || r.orgId !== actor.orgId) throw new NotFoundException('Portal request not found');
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
      await this.supplierAudit({ link, request, ip, userAgent }, 'portal.denied', { reason });
      throw new HttpException({ statusCode: 410, message: `This link is ${reason === 'closed' ? 'for a closed request' : reason}`, reason }, HttpStatus.GONE);
    }
    await this.repo.touchLink(link.id);
    return { link, request, ip, userAgent };
  }

  /** The portal page: the request's findings as the supplier may see them, uploads, and earlier requests. */
  async view(access: PortalAccess, record = true): Promise<PortalView> {
    const { request: r, link } = access;
    if (record) {
      await this.repo.event({ id: randomUUID(), requestId: r.id, linkId: link.id, kind: 'opened', ip: access.ip, userAgent: access.userAgent });
      const key = `${link.id}:${access.ip}`;
      const now = Date.now();
      if (now - (this.auditedOpens.get(key) ?? 0) > AUDIT_OPEN_MS) {
        this.auditedOpens.set(key, now);
        if (this.auditedOpens.size > 10_000) this.auditedOpens.clear();
        await this.supplierAudit(access, 'portal.open', { userAgent: access.userAgent.slice(0, 200) });
      }
    }
    // Everything the page shows is read from one snapshot, the request row included (the guard's copy
    // is older): its status, uploads and findings then always agree, whatever the check is doing.
    return this.repo.snapshot(async (db) => {
      const r = (await db.request(access.request.id)) ?? access.request;
      const importer = r.orgName;
      const latest = await db.latestValidation(r.shipmentId);
      const uploads = await db.uploads(r.id);
      const uploaded = await db.uploadedDocuments(r.id);
      const docs = await db.documents(r.shipmentId);
      const history = r.partyId ? await db.history(r.orgId, r.partyId) : [r];
      const findings: PortalFinding[] = [];
      // A pre-shipment draft has nothing to check until the supplier uploads something.
      const current = latest && (r.kind === 'correction' || r.uploads > 0) ? await db.findingsOf(latest.id) : [];
      const cites = (f: Record<string, unknown>) => (f.evidence as Evidence[]).some((ev) => uploaded.has(ev.documentId));
      for (const f of current) {
        if (r.kind === 'pre_shipment' || r.fingerprints.includes(f.fingerprint) || cites(f)) findings.push(this.supplierFinding(f, 'open', docs, r.partyId, uploaded));
      }
      if (r.kind === 'correction') {
        const present = new Set(current.map((f) => f.fingerprint as string));
        const gone = r.fingerprints.filter((fp) => !present.has(fp));
        for (const f of await db.findingsByFingerprint(r.shipmentId, gone)) findings.push(this.supplierFinding(f, 'fixed', docs, r.partyId, uploaded));
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
        skipped:
          r.kind === 'pre_shipment' && latest && r.uploads > 0
            ? [...latest.skipped, ...latest.ran.filter((id) => HISTORY_RULES.includes(id)).map((ruleId) => ({ ruleId, missing: [], reason: 'history' as const }))]
            : [],
        ...(latest && (r.kind === 'correction' || r.uploads > 0) ? { validatedAt: latest.createdAt } : {}),
        uploads,
        history: history.map((h) => ({ kind: h.kind, ...((h.reference ?? h.shipmentReference) ? { reference: h.reference ?? h.shipmentReference } : {}), status: statusOf(h), createdAt: h.createdAt, current: h.id === r.id })),
        limits: { maxFileBytes: MAX_ATTACHMENT_BYTES, maxFiles: MAX_ATTACHMENTS, maxTotalBytes: MAX_ATTACHMENTS_BYTES },
      };
    });
  }

  /**
   * A finding as a supplier sees it: the rule, its values and pages, and the regulation; never the
   * agent's reasoning, the importer's notes or document ids. A value from an invoice or packing list of
   * another company of the importer is left out.
   */
  private supplierFinding(f: Record<string, unknown>, state: PortalFinding['state'], docs: Map<string, PortalDocumentMeta>, partyId: string | undefined, uploaded: Set<string>): PortalFinding {
    const evidence = (f.evidence as Evidence[]).flatMap((ev) => {
      const doc = docs.get(ev.documentId);
      // Only this shipment's documents: never a value from another shipment of the organization.
      if (!doc && !SLOT_TYPES[ev.documentId]) return [];
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
      const detail = { reason, files: files.map((f) => ({ name: cleanName(f.originalname), size: f.size })) };
      await this.repo.event({ id: randomUUID(), requestId: r.id, linkId: link.id, kind: 'upload_refused', ip: access.ip, userAgent: access.userAgent, detail });
      // Written now: the request fails, and a failed request's notes are not written.
      await this.supplierAudit(access, 'portal.upload_refused', detail, true);
      throw new BadRequestException(message);
    };
    if (files.length === 0) throw new BadRequestException('Send at least one PDF in the "files" field');
    if (files.length > MAX_ATTACHMENTS) await refuse('too_many', `At most ${MAX_ATTACHMENTS} files at once`);
    if (files.reduce((n, f) => n + f.size, 0) > MAX_ATTACHMENTS_BYTES) await refuse('too_large', `At most ${MAX_ATTACHMENTS_BYTES / 1024 / 1024} MB at once`);
    const formats = files.map((f) => inputFormat(f.originalname, new Uint8Array(f.buffer)));
    for (const [i, f] of files.entries()) {
      if (f.size > MAX_ATTACHMENT_BYTES) await refuse('too_large', `${cleanName(f.originalname)} is larger than ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB`);
      // The bytes decide, not the name or the type the browser says: what a shipment upload takes.
      if (!formats[i]) await refuse('not_supported', `${cleanName(f.originalname)} is not a PDF, a photo (JPEG, PNG, HEIC) or a spreadsheet (.xlsx, .csv)`);
    }
    const shipment = await this.shipments.get(r.shipmentId);
    if (!shipment.destination) throw new ConflictException('The shipment has no destination yet; ask the importer');

    // Into the shipment first, like any upload: photos straightened into a PDF, spreadsheets opened,
    // combined PDFs split when extracted, and the organization's plan limits (402) applied.
    const named = files.map((f) => ({ ...f, name: cleanName(f.originalname) }));
    let documents;
    try {
      ({ documents } = await this.shipments.addDocuments(r.shipmentId, named.map((f) => ({ name: f.name, bytes: f.buffer }))));
    } catch (err) {
      const status = err instanceof HttpException ? err.getStatus() : 500;
      if (status === 400 || status === 402) {
        const detail = { reason: status === 402 ? 'usage_limit' : 'unreadable', files: named.map((f) => ({ name: f.name, size: f.size })) };
        await this.repo.event({ id: randomUUID(), requestId: r.id, linkId: link.id, kind: 'upload_refused', ip: access.ip, userAgent: access.userAgent, detail });
        await this.supplierAudit(access, 'portal.upload_refused', detail, true);
      }
      throw err;
    }
    const documentIds = documents.map((d) => ('document' in d ? (d as { document: { id: string } }).document.id : (d as { id: string }).id));

    // Then the conversation: a received message with the files attached, as a reply by email would be.
    const messageId = r.threadId ? randomUUID() : null;
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
      for (const [i, f] of named.entries()) {
        const attachmentId = randomUUID();
        const key = `mail/${messageId}/${attachmentId}`;
        const contentType = attachmentType(formats[i]!, f.name, f.buffer);
        await this.storage.put(key, f.buffer, contentType);
        await this.mailRepo.insertAttachment({ id: attachmentId, messageId, filename: f.name, contentType, size: f.size, storageKey: key });
        await this.mailRepo.linkAttachment(attachmentId, documentIds[i]!);
      }
    }
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
    await this.supplierAudit(access, 'portal.upload', { shipmentId: r.shipmentId, documentIds, messageId, files: named.map((f) => ({ name: f.name, size: f.size })) });
    if (r.threadId) await this.mailRepo.touchThreadIn(r.threadId);
    this.logger.log(`Portal: ${files.length} file(s) for request ${r.id}`);
    void this.kick();
    return this.view({ ...access, request: (await this.repo.request(r.id))! }, false);
  }

  /**
   * The audit log, with the supplier as actor: no user, the organization the token belongs to (never a
   * session's), the link and the client address. Inside a request it is written when the request
   * succeeds; elsewhere, or with `now` (a refusal, whose request fails), at once.
   */
  private async supplierAudit(access: PortalAccess, action: string, after: Record<string, unknown>, now = false) {
    const actor = { orgId: access.request.orgId, userId: null, email: `supplier:${access.request.supplierName ?? 'unknown'} (portal link ${access.link.id.slice(0, 8)})`, ip: access.ip };
    const entry = { orgId: access.request.orgId, action, entity: 'portal_request', entityId: access.request.id, after: { linkId: access.link.id, ...after } };
    if (this.audit.scope() && !now) {
      this.audit.setActor(actor);
      this.audit.note(entry);
    } else await this.audit.record(actor, entry);
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

/** The type an uploaded file is kept with as an attachment of the conversation (served as mail attachments are). */
function attachmentType(format: DocumentFormat, name: string, bytes: Buffer): string {
  if (format === 'PDF') return 'application/pdf';
  if (format === 'SPREADSHEET') return /\.xls[xm]$/i.test(name) ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
  return 'image/heic';
}
