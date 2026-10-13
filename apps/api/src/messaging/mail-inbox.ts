import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { simpleParser, type AddressObject, type ParsedMail } from 'mailparser';
import { STORAGE, type ObjectStorage } from '../storage/storage';
import { addressOf, MAX_ATTACHMENT_BYTES, TOKEN_IN_ADDRESS, TOKEN_IN_SUBJECT } from './mail.config';
import { MailRepository } from './mail.repository';

/** Kinds of attachment kept from received mail: documents and pictures of them. */
const KEPT = /^(application\/pdf|image\/(png|jpe?g|gif|webp|tiff)|text\/csv|application\/vnd\.(ms-excel|openxmlformats-officedocument\.(spreadsheetml|wordprocessingml)\.[a-z]+)|application\/msword)$/i;

export type IngestResult = { status: 'stored'; messageId: string; threadId: string | null } | { status: 'duplicate' };

const stripId = (v: string) => v.trim().replace(/^<|>$/g, '');
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
    @Inject(STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async ingest(raw: Buffer): Promise<IngestResult> {
    const mail = await simpleParser(raw, { skipHtmlToText: false });
    const messageId = mail.messageId ? stripId(mail.messageId) : `generated-${randomUUID()}@doccheck`;
    if (await this.repo.hasMessageId(messageId)) return { status: 'duplicate' };

    const threadId = await this.findThread(mail);
    const id = randomUUID();
    const from = mail.from?.value[0]?.address?.toLowerCase() ?? 'unknown';
    const references = [...(Array.isArray(mail.references) ? mail.references : mail.references ? [mail.references] : [])].map(stripId);
    const bounce = this.isBounce(mail, from);
    await this.repo.insertMessage({
      id,
      threadId,
      userId: null,
      direction: 'in',
      status: 'received',
      from: mail.from?.text ?? from,
      to: addresses(mail.to),
      cc: addresses(mail.cc),
      subject: mail.subject ?? '',
      text: (mail.text ?? '').slice(0, 200_000),
      messageId,
      inReplyTo: mail.inReplyTo ? stripId(mail.inReplyTo) : null,
      references,
      receivedAt: (mail.date ?? new Date()).toISOString(),
    });
    for (const a of mail.attachments) {
      if (!KEPT.test(a.contentType) || a.size > MAX_ATTACHMENT_BYTES || a.related) continue;
      const attachmentId = randomUUID();
      const filename = (a.filename || `attachment-${attachmentId.slice(0, 8)}`).replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 200);
      const key = `mail/${id}/${attachmentId}`;
      await this.storage.put(key, a.content, a.contentType);
      await this.repo.insertAttachment({ id: attachmentId, messageId: id, filename, contentType: a.contentType.toLowerCase(), size: a.size, storageKey: key });
    }
    if (bounce) await this.markBounced(mail, raw);
    if (threadId) await this.repo.touchThreadIn(threadId);
    else this.logger.log(`Received mail no thread claims, from ${from}: ${mail.subject ?? ''}`);
    return { status: 'stored', messageId: id, threadId };
  }

  private async findThread(mail: ParsedMail): Promise<string | null> {
    const refs = [mail.inReplyTo, ...(Array.isArray(mail.references) ? mail.references : mail.references ? [mail.references] : [])].filter((x): x is string => !!x).map(stripId);
    const byId = await this.repo.threadByMessageIds(refs);
    if (byId) return byId;
    const headerAddresses = ['delivered-to', 'x-original-to', 'envelope-to'].flatMap((h) => {
      const v = mail.headers.get(h);
      return (Array.isArray(v) ? v : v ? [v] : []).map((x) => (typeof x === 'string' ? x : JSON.stringify(x)));
    });
    for (const address of [...addresses(mail.to), ...addresses(mail.cc), ...headerAddresses.map(addressOf)]) {
      const token = TOKEN_IN_ADDRESS.exec(address)?.[1];
      const thread = token ? await this.repo.threadByToken(token) : null;
      if (thread) return thread;
    }
    const token = TOKEN_IN_SUBJECT.exec(mail.subject ?? '')?.[1];
    return token ? this.repo.threadByToken(token) : null;
  }

  private isBounce(mail: ParsedMail, from: string) {
    const type = String(mail.headers.get('content-type') && (mail.headers.get('content-type') as { value?: string }).value);
    return /mailer-daemon|postmaster/i.test(from) || /multipart\/report/i.test(type);
  }

  /** A delivery failure report: the original Message-ID it quotes is marked failed. */
  private async markBounced(mail: ParsedMail, raw: Buffer) {
    const quoted = [...raw.toString('utf8').matchAll(/Message-ID:\s*<([^>]+)>/gi)].map((m) => m[1]).filter((id) => id !== stripId(mail.messageId ?? ''));
    for (const id of quoted) {
      if (await this.repo.markBounced(id, `Bounced: ${mail.subject ?? 'delivery failed'}`)) this.logger.warn(`Message ${id} bounced`);
    }
  }
}
