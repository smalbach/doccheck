import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTransport, type Transporter } from 'nodemailer';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

const DEFAULT_FROM = 'DocCheck <no-reply@localhost>';

/**
 * Sends email through any SMTP server given as SMTP_URL (smtps://user:pass@host:465), from MAIL_FROM.
 * Without SMTP_URL nothing is sent: the mail is logged (dev mode), and also written as JSON to
 * MAIL_CAPTURE_DIR when that is set (the e2e tests read reset links from there).
 */
@Injectable()
export class Mailer implements OnApplicationBootstrap {
  private readonly logger = new Logger(Mailer.name);
  private transport?: Transporter;

  private smtpUrl(): string | undefined {
    return process.env.SMTP_URL || undefined;
  }

  onApplicationBootstrap() {
    const url = this.smtpUrl();
    if (!url) {
      this.logger.log('SMTP_URL is not set: emails (password reset links) are logged here instead of sent');
      return;
    }
    let host = '?';
    try {
      host = new URL(url).host;
    } catch {}
    this.logger.log(`Email is sent through SMTP at ${host}`);
    if (!process.env.MAIL_FROM) this.logger.warn(`MAIL_FROM is not set: emails are sent from "${DEFAULT_FROM}", which most providers refuse`);
  }

  async send(mail: Mail): Promise<void> {
    const url = this.smtpUrl();
    if (url) {
      this.transport ??= createTransport(url);
      await this.transport.sendMail({ from: process.env.MAIL_FROM || DEFAULT_FROM, ...mail });
      return;
    }
    this.logger.log(`Email not sent (no SMTP_URL) to ${mail.to}: ${mail.subject}\n${mail.text}`);
    const dir = process.env.MAIL_CAPTURE_DIR;
    if (dir) {
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `${Date.now()}-${randomUUID()}.json`), JSON.stringify(mail));
    }
  }
}
