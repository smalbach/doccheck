import { Injectable, Logger } from '@nestjs/common';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTransport, type Transporter } from 'nodemailer';
import { replyAddress, subjectTag } from './mail.config';
import type { OutboxItem } from './mail.repository';

/**
 * Sends one outgoing message through SMTP_URL. Without it, the message is built the same way and
 * only captured: logged, and written as an .eml file to MAIL_CAPTURE_DIR when set.
 */
@Injectable()
export class MailTransport {
  private readonly logger = new Logger(MailTransport.name);
  private smtp?: { url: string; transport: Transporter };
  private readonly capture = createTransport({ streamTransport: true, buffer: true, newline: 'unix' });

  /** smtp, or log when the message is only captured. */
  get mode(): 'smtp' | 'log' {
    return process.env.SMTP_URL ? 'smtp' : 'log';
  }

  async send(item: OutboxItem): Promise<'smtp' | 'log'> {
    const message = {
      from: item.from,
      to: item.to,
      cc: item.cc.length ? item.cc : undefined,
      ...(item.threadToken ? { replyTo: replyAddress(item.threadToken) } : {}),
      subject: item.threadToken && !item.subject.includes(subjectTag(item.threadToken)) ? `${item.subject} ${subjectTag(item.threadToken)}` : item.subject,
      text: item.text,
      messageId: `<${item.messageId}>`,
      ...(item.inReplyTo ? { inReplyTo: `<${item.inReplyTo}>` } : {}),
      ...(item.references.length ? { references: item.references.map((r) => `<${r}>`) } : {}),
      headers: { 'X-DocCheck-Thread': item.threadToken ?? '' },
    };
    const url = process.env.SMTP_URL;
    if (url) {
      if (this.smtp?.url !== url) this.smtp = { url, transport: createTransport(url) };
      await this.smtp.transport.sendMail(message);
      return 'smtp';
    }
    const built = await this.capture.sendMail(message);
    this.logger.log(`Email not sent (no SMTP_URL) to ${item.to.join(', ')}: ${message.subject}`);
    const dir = process.env.MAIL_CAPTURE_DIR;
    if (dir) {
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `${Date.now()}-${item.id}.eml`), built.message as Buffer);
    }
    return 'log';
  }
}
