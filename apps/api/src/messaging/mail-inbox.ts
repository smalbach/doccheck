import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { simpleParser, type AddressObject, type ParsedMail } from 'mailparser';
import { STORAGE, type ObjectStorage } from '../storage/storage';
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS, MAX_ATTACHMENTS_BYTES, TOKEN_IN_ADDRESS, TOKEN_IN_SUBJECT, addressOf } from './mail.config';
import { MailIntakeService, intakeEnabled } from './mail-intake.service';
import { MailRepository } from './mail.repository';
import { PROBE_IN_ADDRESS, PlusCheckService } from './plus-check.service';

/** Kinds of attachment kept from received mail: documents and pictures of them. */
const KEPT = /^(application\/pdf|image\/(png|jpe?g|gif|webp|tiff)|text\/csv|application\/vnd\.(ms-excel|openxmlformats-officedocument\.(spreadsheetml|wordprocessingml)\.[a-z]+)|application\/msword)$/i;

/** probe: the test email of the +code check (PlusCheckService), not kept. */
export type IngestResult = { status: 'stored'; messageId: string; threadId: string | null } | { status: 'duplicate' } | { status: 'probe' };

/** Postgres text cannot hold NUL, and a mail can decode one from quoted-printable: drop them. */
const clean = (v: string) => v.replace(/\u0000/g, '');
const stripId = (v: string) => clean(v).trim().replace(/^<|>$/g, '').slice(0, 998);
/** The recipients a delivery report says failed. */
const FAILED_RECIPIENT = /^(?:Final|Original)-Recipient:[ \t]*rfc822;[ \t]*<?([^\s<>;]{3,320})>?/gim;
const DIAGNOSTIC = /^Diagnostic-Code:[ \t]*[^;\r\n]*;[ \t]*([^\r\n]{1,300})/im;
/** A Message-ID quoted in a delivery report's original headers (bounded: never scans unbounded input). */
const QUOTED_ID = /^Message-ID:[ \t]*<([^>\r\n]{1,998})>/gim;
const addresses = (a: AddressObject | AddressObject[] | undefined) =>
  (Array.isArray(a) ? a : a ? [a] : []).flatMap((x) => x.value.map((v) => (v.address ?? '').toLowerCase()).filter(Boolean));

/**
 * Stores a received email (raw RFC 5322) in the thread it answers: by In-Reply-To / References to one
 * of our Message-IDs, else the "+token" of the address it was sent to, else the "[DC-token]" in the
 * subject. Unclaimed mail is kept for an admin to assign. A delivery failure report marks the
 * message it bounces as failed.
 */
@Injectable()
export class MailInbox {
  private readonly logger = new Logger(MailInbox.name);

  constructor(
    private readonly repo: MailRepository,
    private readonly intake: MailIntakeService,
    private readonly plus: PlusCheckService,
    @Inject(STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async ingest(raw: Buffer): Promise<IngestResult> {
    const mail = await simpleParser(raw, { skipHtmlToText: false });
    const messageId = mail.messageId ? stripId(mail.messageId) : `generated-${randomUUID()}@doccheck`;
    if (await this.repo.hasMessageId(messageId)) return { status: 'duplicate' };

    const bounce = this.isBounce(mail);
    if (!bounce) {
      const probe = [...addresses(mail.to), ...this.envelopeRecipients(mail)].map((a) => PROBE_IN_ADDRESS.exec(a)?.[1]).find((t) => !!t);
      if (probe && (await this.plus.arrived(probe))) return { status: 'probe' };
    }

    let threadId = await this.findThread(mail);
    const id = randomUUID();
    // One sender, written by us from the parsed address: the From text itself can list several.
    const sender = mail.from?.value[0];
    const from = clean(sender?.address?.toLowerCase() ?? 'unknown');
    const fromText = sender?.name ? `${clean(sender.name).replace(/["<>\r\n]/g, '').slice(0, 200)} <${from}>` : from;
    const references = [...(Array.isArray(mail.references) ? mail.references : mail.references ? [mail.references] : [])].map(stripId);
    const check = senderCheck(mail);
    // Not an answer to a conversation: documents sent by email to a user's intake address (or from
    // their own verified address) start a conversation of their own and a shipment.
    let intakeOwner: string | null = null;
    if (!threadId && !bounce && intakeEnabled()) {
      intakeOwner = await this.intake.owner([...addresses(mail.to), ...addresses(mail.cc), ...this.envelopeRecipients(mail)], from, check === 'pass');
      if (intakeOwner) {
        threadId = randomUUID();
        await this.repo.insertThread({
          id: threadId,
          userId: intakeOwner,
          token: randomUUID().replace(/-/g, '').slice(0, 10),
          kind: 'intake',
          subject: clean(mail.subject ?? '').slice(0, 300) || '(no subject)',
          status: 'replied',
          fingerprints: [],
          dueAt: null,
        });
      }
    }
    await this.repo.insertMessage({
      id,
      threadId,
      userId: null,
      direction: 'in',
      status: 'received',
      from: fromText,
      to: addresses(mail.to).map(clean),
      cc: addresses(mail.cc).map(clean),
      subject: clean(mail.subject ?? '').slice(0, 998),
      text: clean(mail.text ?? '').slice(0, 200_000),
      messageId,
      inReplyTo: mail.inReplyTo ? stripId(mail.inReplyTo) : null,
      references,
      receivedAt: (mail.date && !Number.isNaN(mail.date.getTime()) ? mail.date : new Date()).toISOString(),
      senderCheck: check,
    });
    // Mail no conversation claims keeps its text only: anyone can write to the mailbox.
    let kept = 0;
    let bytes = 0;
    const pdfs: { attachmentId: string; filename: string; storageKey: string }[] = [];
    for (const a of threadId ? mail.attachments : []) {
      if (!KEPT.test(a.contentType) || a.size > MAX_ATTACHMENT_BYTES || a.related) continue;
      if (kept >= MAX_ATTACHMENTS || bytes + a.size > MAX_ATTACHMENTS_BYTES) break;
      kept++;
      bytes += a.size;
      const attachmentId = randomUUID();
      const filename = clean(a.filename || `attachment-${attachmentId.slice(0, 8)}`).replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 200);
      const key = `mail/${id}/${attachmentId}`;
      await this.storage.put(key, a.content, a.contentType);
      await this.repo.insertAttachment({ id: attachmentId, messageId: id, filename, contentType: a.contentType.toLowerCase(), size: a.size, storageKey: key });
      if (a.contentType.toLowerCase() === 'application/pdf') pdfs.push({ attachmentId, filename, storageKey: key });
    }
    if (bounce) await this.markBounced(mail);
    if (bounce || /^(mailer-daemon|postmaster)@/i.test(from)) await this.checkPlusBounce(mail, bounce);
    if (threadId) await this.repo.touchThreadIn(threadId);
    else this.logger.log(`Received mail no thread claims, from ${from}: ${mail.subject ?? ''}`);
    if (intakeOwner && threadId) {
      // The mail is stored whatever happens to its documents; a failure shows in its conversation.
      await this.intake.start({ threadId, messageId: id, userId: intakeOwner, subject: mail.subject ?? '', pdfs }).catch((err) => this.logger.error(`Intake of ${id} failed: ${err instanceof Error ? err.message : err}`));
    }
    return { status: 'stored', messageId: id, threadId };
  }

  private async findThread(mail: ParsedMail): Promise<string | null> {
    const refs = [mail.inReplyTo, ...(Array.isArray(mail.references) ? mail.references : mail.references ? [mail.references] : [])].filter((x): x is string => !!x).map(stripId);
    const byId = await this.repo.threadByMessageIds(refs);
    if (byId) return byId;
    for (const address of [...addresses(mail.to), ...addresses(mail.cc), ...this.envelopeRecipients(mail)]) {
      const token = TOKEN_IN_ADDRESS.exec(address)?.[1];
      const thread = token ? await this.repo.threadByToken(token) : null;
      if (thread) return thread;
    }
    const token = TOKEN_IN_SUBJECT.exec(mail.subject ?? '')?.[1];
    return token ? this.repo.threadByToken(token) : null;
  }

  /** Where the mail was delivered, as the receiving server wrote it (a forward keeps the original To). */
  private envelopeRecipients(mail: ParsedMail): string[] {
    return ['delivered-to', 'x-original-to', 'envelope-to'].flatMap((h) => {
      const v = mail.headers.get(h);
      return (Array.isArray(v) ? v : v ? [v] : []).map((x) => addressOf(typeof x === 'string' ? x : JSON.stringify(x)));
    });
  }

  /** A delivery status notification: multipart/report; report-type=delivery-status (not who the sender says it is). */
  private isBounce(mail: ParsedMail) {
    const type = mail.headers.get('content-type') as { value?: string; params?: Record<string, string> } | undefined;
    return /^multipart\/report$/i.test(type?.value ?? '') && /delivery-status/i.test(type?.params?.['report-type'] ?? '');
  }

  /**
   * A delivery report for one of our +addresses (the +code check's, or a conversation's): the mail
   * server does not take +codes. A plain-text bounce counts only when it names the pending check's
   * address, which nobody else knows.
   */
  private async checkPlusBounce(mail: ParsedMail, report: boolean) {
    const pending = this.plus.pending();
    // mailparser puts a message/delivery-status part in the text; some versions keep it as an attachment.
    const status = mail.attachments.find((a) => /^message\/(global-)?delivery-status$/i.test(a.contentType));
    const text = report ? (status ? status.content.toString('utf8') : (mail.text ?? '')).slice(0, 64 * 1024) : '';
    const detail = DIAGNOSTIC.exec(text)?.[1]?.trim() || clean(mail.subject ?? 'delivery failed').slice(0, 300);
    for (const [, address] of [...text.matchAll(FAILED_RECIPIENT)].slice(0, 10)) {
      const a = address!.toLowerCase();
      if (!this.plus.isOwnPlusAddress(a)) continue;
      const token = PROBE_IN_ADDRESS.exec(a)?.[1] ?? TOKEN_IN_ADDRESS.exec(a)?.[1];
      if (token && (token === pending?.token || (await this.repo.threadByToken(token)))) return this.plus.reject(a, detail);
    }
    if (pending && (mail.text ?? '').slice(0, 64 * 1024).toLowerCase().includes(`+${pending.token}@`)) await this.plus.reject(pending.address, detail);
  }

  /** The original message a delivery report returns (its headers part, first 64 KB) is marked failed. */
  private async markBounced(mail: ParsedMail) {
    const original = mail.attachments.find((a) => /^(message\/rfc822|text\/rfc822-headers|message\/global-headers)$/i.test(a.contentType));
    if (!original) return;
    const head = original.content.subarray(0, 64 * 1024).toString('utf8').split(/\r?\n\r?\n/)[0] ?? '';
    const quoted = [...head.matchAll(QUOTED_ID)].map((m) => m[1]!).slice(0, 5);
    for (const id of quoted) {
      if (await this.repo.markBounced(id, `Bounced: ${mail.subject ?? 'delivery failed'}`)) this.logger.warn(`Message ${id} bounced`);
    }
  }
}

/** What the receiving server said about the sender (Authentication-Results): fail when DMARC, DKIM or SPF failed. */
function senderCheck(mail: ParsedMail): 'pass' | 'fail' | 'none' {
  const raw = mail.headers.get('authentication-results');
  const text = (Array.isArray(raw) ? raw : raw ? [raw] : []).map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ').slice(0, 4000);
  if (!text) return 'none';
  if (/\b(dmarc|dkim|spf)=(fail|softfail|permerror)\b/i.test(text)) return 'fail';
  return /\bdmarc=pass\b|\bdkim=pass\b/i.test(text) ? 'pass' : 'none';
}
