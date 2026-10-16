import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { appUrl } from '../auth/app-url';
import { PG_POOL } from '../db/db.module';
import { isDemo } from '../demo/demo-mode';
import { ShipmentsService } from '../shipments/shipments.service';
import { STORAGE, type ObjectStorage } from '../storage/storage';
import { addressOf, mailFrom, messageIdDomain, replyAddress } from './mail.config';
import { MailRepository } from './mail.repository';
import { OutboxWorker } from './outbox.worker';

/** Emails turned into shipments per user per hour: more are kept as mail, not processed. */
const INTAKES_PER_HOUR = 30;
/** "+in-<token>@": a user's intake address. */
export const INTAKE_IN_ADDRESS = /\+in-([a-z0-9]{6,16})@/i;

export const intakeEnabled = () => process.env.MAIL_INTAKE === 'true';

export type IntakeStatus = 'extracting' | 'validating' | 'validated' | 'needs_destination' | 'failed' | 'skipped';
export interface IntakeView {
  id: string;
  status: IntakeStatus;
  shipmentId?: string;
  createdShipment: boolean;
  documents: number;
  findings?: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Documents by email: an email with PDFs sent to a user's intake address (or from their own verified
 * address) becomes a shipment, or completes the one whose reference its subject names; its PDFs
 * are extracted, the destination is read from the documents when the shipment has none, and the
 * shipment is validated. The user sees it in the inbox; the sender gets a summary when it is the
 * user themselves.
 */
@Injectable()
export class MailIntakeService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(MailIntakeService.name);
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly repo: MailRepository,
    private readonly shipments: ShipmentsService,
    private readonly outbox: OutboxWorker,
    @Inject(STORAGE) private readonly storage: ObjectStorage,
  ) {}

  onApplicationBootstrap() {
    if (isDemo()) return;
    this.timer = setInterval(() => void this.kick(), Math.max(500, Number(process.env.MAIL_INTAKE_MS ?? 3000) || 3000));
  }

  async onApplicationShutdown() {
    clearInterval(this.timer);
    await this.running;
  }

  /** The user's intake address (made the first time), or why there is none. */
  async address(userId: string): Promise<{ enabled: boolean; address?: string; ownAddress: string }> {
    const { rows } = await this.pool.query<{ email: string; intake_token: string | null }>('select email, intake_token from users where id = $1', [userId]);
    const user = rows[0]!;
    if (!intakeEnabled() || process.env.MAIL_PLUS_ADDRESSING === 'false') return { enabled: intakeEnabled(), ownAddress: user.email };
    let token = user.intake_token;
    if (!token) {
      const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
      token = [...randomBytes(10)].map((b) => alphabet[b % alphabet.length]).join('');
      await this.pool.query('update users set intake_token = $2 where id = $1 and intake_token is null', [userId, token]);
      token = (await this.pool.query<{ intake_token: string }>('select intake_token from users where id = $1', [userId])).rows[0]!.intake_token;
    }
    return { enabled: true, address: replyAddress(token).replace(`+${token}@`, `+in-${token}@`), ownAddress: user.email };
  }

  /**
   * Whose documents these are: the user whose intake address the mail was sent to, else the user
   * whose email is the sender, when the receiving server verified it (DMARC/DKIM pass).
   */
  async owner(recipients: string[], from: string, senderVerified: boolean): Promise<string | null> {
    for (const r of recipients) {
      const token = INTAKE_IN_ADDRESS.exec(r)?.[1];
      if (!token) continue;
      const { rows } = await this.pool.query('select id from users where intake_token = $1', [token.toLowerCase()]);
      if (rows[0]) return rows[0].id;
    }
    if (!senderVerified) return null;
    const { rows } = await this.pool.query('select id from users where lower(email) = $1', [addressOf(from)]);
    return rows[0]?.id ?? null;
  }

  /** A received intake email: its PDFs go into a shipment and start extracting. */
  async start(input: { threadId: string; messageId: string; userId: string; subject: string; pdfs: { attachmentId: string; filename: string; storageKey: string }[] }) {
    const id = randomUUID();
    const insert = (status: IntakeStatus, extra: { shipmentId?: string; created?: boolean; documents?: number; error?: string } = {}) =>
      this.pool.query(
        `insert into mail_intakes (id, thread_id, message_id, user_id, shipment_id, status, created_shipment, documents, error, org_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, (select org_id from mail_threads where id = $2))`,
        [id, input.threadId, input.messageId, input.userId, extra.shipmentId ?? null, status, extra.created ?? false, extra.documents ?? 0, extra.error ?? null],
      );
    const { rows: [recent] } = await this.pool.query(`select count(*)::int as n from mail_intakes where user_id = $1 and created_at > now() - interval '1 hour'`, [input.userId]);
    if (recent.n >= INTAKES_PER_HOUR) return insert('skipped', { error: `More than ${INTAKES_PER_HOUR} emails with documents in an hour: kept as mail only` });
    if (input.pdfs.length === 0) return insert('skipped', { error: 'No PDF attached' });

    // The organization the user worked in last (the intake thread took it when it was stored).
    const { rows: [thread] } = await this.pool.query<{ org_id: string }>('select org_id from mail_threads where id = $1', [input.threadId]);
    const named = await this.shipmentNamedIn(thread!.org_id, input.subject);
    const reference = cleanSubject(input.subject) || `Email ${new Date().toISOString().slice(0, 10)}`;
    const shipmentId = named ?? (await this.shipments.create({ reference }, input.userId, thread!.org_id)).id;
    await this.pool.query('update mail_threads set shipment_id = $2 where id = $1', [input.threadId, shipmentId]);
    const files = await Promise.all(input.pdfs.map(async (p) => ({ ...p, bytes: await this.storage.get(p.storageKey) })));
    const usable = files.filter((f) => f.bytes.subarray(0, 5).toString('latin1').startsWith('%PDF'));
    if (usable.length === 0) return insert('skipped', { shipmentId, created: !named, error: 'The attachments are not readable PDFs' });
    const { documents } = await this.shipments.addDocuments(shipmentId, usable.map((f) => ({ name: f.filename, bytes: f.bytes })));
    for (const [i, d] of documents.entries()) {
      const documentId = 'document' in d ? (d as { document: { id: string } }).document.id : (d as { id: string }).id;
      await this.repo.linkAttachment(usable[i]!.attachmentId, documentId);
    }
    await insert('extracting', { shipmentId, created: !named, documents: usable.length });
    this.logger.log(`Documents by email: ${usable.length} PDF(s) into shipment ${shipmentId}${named ? '' : ' (new)'}`);
    void this.kick();
  }

  async forThread(threadId: string): Promise<IntakeView[]> {
    const { rows } = await this.pool.query('select * from mail_intakes where thread_id = $1 order by created_at', [threadId]);
    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      ...(r.shipment_id ? { shipmentId: r.shipment_id } : {}),
      createdShipment: r.created_shipment,
      documents: r.documents,
      ...(r.findings !== null ? { findings: r.findings } : {}),
      ...(r.error ? { error: r.error } : {}),
      createdAt: new Date(r.created_at).toISOString(),
      updatedAt: new Date(r.updated_at).toISOString(),
    }));
  }

  /** Validates again an intake that waited for a destination (the user set it). */
  async retry(userId: string, intakeId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `update mail_intakes set status = 'extracting', error = null, updated_at = now() where id = $1 and user_id = $2 and status in ('needs_destination', 'failed')`,
      [intakeId, userId],
    );
    void this.kick();
    return rowCount === 1;
  }

  kick(): Promise<void> {
    this.running ??= this.drain()
      .catch((err) => this.logger.error(`Intake: ${err instanceof Error ? err.message : err}`))
      .finally(() => (this.running = undefined));
    return this.running;
  }

  /** Intakes whose documents are all extracted (or failed): destination, validation, notice. */
  private async drain() {
    for (;;) {
      const { rows } = await this.pool.query<{ id: string; shipment_id: string; thread_id: string; user_id: string }>(
        `update mail_intakes set status = 'validating', updated_at = now()
         where id = (
           select i.id from mail_intakes i where i.status = 'extracting' and i.shipment_id is not null
             and not exists (select 1 from documents d where d.shipment_id = i.shipment_id and d.status in ('QUEUED', 'EXTRACTING'))
           order by i.created_at limit 1 for update skip locked)
         returning id, shipment_id, thread_id, user_id`,
      );
      const job = rows[0];
      if (!job) return;
      await this.finish(job);
    }
  }

  private async finish(job: { id: string; shipment_id: string; thread_id: string; user_id: string }) {
    const set = (status: IntakeStatus, fields: { findings?: number; error?: string } = {}) =>
      this.pool.query('update mail_intakes set status = $2, findings = $3, error = $4, updated_at = now() where id = $1', [job.id, status, fields.findings ?? null, fields.error ?? null]);
    try {
      const shipment = await this.shipments.get(job.shipment_id);
      if (!shipment.destination) {
        const destination = await this.destinationOf(job.shipment_id);
        if (!destination) {
          await set('needs_destination', { error: 'The documents do not say whether it goes to Canada or the United States' });
          return this.notify(job, 'needs_destination');
        }
        await this.shipments.update(job.shipment_id, { destination });
      }
      const result = await this.shipments.validate(job.shipment_id, {}, {});
      await set('validated', { findings: result.findings.length });
      await this.notify(job, 'validated', result.findings.length);
    } catch (err) {
      await set('failed', { error: (err instanceof Error ? err.message : String(err)).slice(0, 500) });
      await this.notify(job, 'failed');
    }
  }

  /** CA or US from the extracted documents: the B/L's discharge or delivery port, the port of entry, the consignee's country. */
  private async destinationOf(shipmentId: string): Promise<'CA' | 'US' | null> {
    const { rows } = await this.pool.query<{ d: string | null }>(
      `with cur as (select document_id from current_documents where shipment_id = $1)
       select coalesce(
         (select b.port_of_discharge_country from bills_of_lading b join cur using (document_id) where b.port_of_discharge_country in ('CA', 'US') limit 1),
         (select b.place_of_delivery_country from bills_of_lading b join cur using (document_id) where b.place_of_delivery_country in ('CA', 'US') limit 1),
         (select i.port_of_entry_country from invoices i join cur using (document_id) where i.port_of_entry_country in ('CA', 'US') limit 1),
         (select dp.country from document_parties dp join cur using (document_id) where dp.role in ('consignee', 'buyer') and dp.country in ('CA', 'US') limit 1)
       ) as d`,
      [shipmentId],
    );
    return (rows[0]?.d as 'CA' | 'US' | null) ?? null;
  }

  /** The conversation shows something new; the sender gets a summary when they are the user. */
  private async notify(job: { id: string; thread_id: string; user_id: string; shipment_id: string }, status: IntakeStatus, findings = 0) {
    await this.repo.touchThreadIn(job.thread_id);
    if (process.env.MAIL_INTAKE_NOTIFY === 'false') return;
    const { rows } = await this.pool.query(
      `select u.email, u.language, m.from_addr, m.message_id, m."references", t.subject, s.reference
       from mail_intakes i join users u on u.id = i.user_id join mail_messages m on m.id = i.message_id
       join mail_threads t on t.id = i.thread_id left join shipments s on s.id = i.shipment_id where i.id = $1`,
      [job.id],
    );
    const r = rows[0];
    if (!r || addressOf(r.from_addr) !== r.email.toLowerCase()) return;
    const link = appUrl() ? `${appUrl()}/#/app/s/${job.shipment_id}` : '';
    const lines = [summaryLine(r.language, status, r.reference ?? '', findings)];
    await this.repo.insertMessage({
      id: randomUUID(),
      threadId: job.thread_id,
      userId: null,
      direction: 'out',
      status: 'queued',
      from: mailFrom(),
      to: [r.email.toLowerCase()],
      cc: [],
      subject: /^re:/i.test(r.subject) ? r.subject : `Re: ${r.subject}`,
      text: [...lines, ...(link ? ['', link] : []), '', 'DocCheck'].join('\n'),
      messageId: `${randomUUID()}@${messageIdDomain()}`,
      inReplyTo: r.message_id,
      references: [...(r.references ?? []), r.message_id].filter(Boolean).slice(-20),
    });
    await this.pool.query(`update mail_threads set due_at = null where id = $1`, [job.thread_id]);
    void this.outbox.kick();
  }

  /** The organization's shipment whose reference the subject names (the most recent one). */
  private async shipmentNamedIn(orgId: string, subject: string): Promise<string | null> {
    const { rows } = await this.pool.query(
      `select id from shipments where org_id = $1 and length(reference) >= 3 and position(lower(reference) in lower($2)) > 0
         and created_at > now() - interval '120 days'
       order by length(reference) desc, created_at desc limit 1`,
      [orgId, subject],
    );
    return rows[0]?.id ?? null;
  }
}

/** The summary sent back to the user, in the language they use the app in (English when unknown). */
export function summaryLine(language: string | null, status: IntakeStatus, reference: string, findings: number): string {
  const ref = reference.trim();
  switch (language) {
    case 'es':
      return status === 'validated'
        ? `El envío ${ref} se leyó y se validó: ${findings === 0 ? 'sin hallazgos' : findings === 1 ? '1 hallazgo por revisar' : `${findings} hallazgos por revisar`}.`
        : status === 'needs_destination'
          ? `El envío ${ref} se leyó, pero los documentos no dicen si va a Canadá o a Estados Unidos. Indica el destino para validarlo.`
          : `El envío ${ref} no se pudo validar automáticamente. Ábrelo para ver por qué.`;
    case 'fr':
      return status === 'validated'
        ? `L’envoi ${ref} a été lu et vérifié : ${findings === 0 ? 'aucun constat' : findings === 1 ? '1 constat à examiner' : `${findings} constats à examiner`}.`
        : status === 'needs_destination'
          ? `L’envoi ${ref} a été lu, mais les documents n’indiquent pas s’il va au Canada ou aux États-Unis. Indiquez la destination pour le vérifier.`
          : `L’envoi ${ref} n’a pas pu être vérifié automatiquement. Ouvrez-le pour voir pourquoi.`;
    default:
      return status === 'validated'
        ? `Shipment ${ref} was read and checked: ${findings === 0 ? 'no findings' : findings === 1 ? '1 finding to review' : `${findings} findings to review`}.`
        : status === 'needs_destination'
          ? `Shipment ${ref} was read, but the documents do not say whether it goes to Canada or the United States. Set the destination to check it.`
          : `Shipment ${ref} could not be checked automatically. Open it to see why.`;
  }
}

/** "Fwd: RE: Invoice 4411 [DC-x]" → "Invoice 4411". */
function cleanSubject(subject: string): string {
  return subject
    .replace(/\[DC-[a-z0-9]+\]/gi, '')
    .replace(/^\s*((re|fw|fwd|rv|tr)\s*:\s*)+/i, '')
    .trim()
    .slice(0, 120);
}
