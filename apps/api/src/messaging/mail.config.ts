/**
 * Mail settings from the environment (docs/MESSAGING.md).
 * - SMTP_URL, MAIL_FROM: outgoing mail (without SMTP_URL messages are only captured: logged, and written
 *   as .eml files to MAIL_CAPTURE_DIR when set).
 * - MAIL_REPLY_TO: the mailbox replies go to, e.g. docs@example.com; each thread uses
 *   docs+<token>@example.com when MAIL_PLUS_ADDRESSING is not "false".
 * - IMAP_URL (imaps://user:pass@host:993), IMAP_MAILBOX (INBOX), IMAP_POLL_MS: where replies are read.
 * - MAIL_INBOUND_SECRET: enables POST /mail/inbound for providers that forward mail as a webhook.
 * - MAIL_FOLLOW_UP_DAYS: when an unanswered request is overdue (3 days).
 */
export const DEFAULT_FROM = 'DocCheck <no-reply@localhost>';

export const mailFrom = () => process.env.MAIL_FROM || DEFAULT_FROM;

/** The address part of "Name <a@b>" or "a@b". */
export function addressOf(value: string): string {
  const m = /<([^>]+)>/.exec(value);
  return (m ? m[1] : value).trim().toLowerCase();
}

/** The reply-to address of a thread: the mailbox with "+token" when plus addressing is on. */
export function replyAddress(token: string): string {
  const base = process.env.MAIL_REPLY_TO || addressOf(mailFrom());
  if (process.env.MAIL_PLUS_ADDRESSING === 'false') return base;
  const [local, domain] = addressOf(base).split('@');
  return domain ? `${local}+${token}@${domain}` : base;
}

/** The domain Message-IDs are made with. */
export const messageIdDomain = () => addressOf(mailFrom()).split('@')[1] || 'doccheck.local';

export const followUpDays = () => {
  const n = Number(process.env.MAIL_FOLLOW_UP_DAYS ?? 3);
  return Number.isFinite(n) && n > 0 ? n : 3;
};

export const imapPollMs = () => Math.max(15_000, Number(process.env.IMAP_POLL_MS ?? 60_000) || 60_000);

/** Attachments kept from received mail: at most this many bytes each. */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

/** Retries of an outgoing message: after 1, 2, 4, 8 minutes, then failed. */
export const MAX_ATTEMPTS = 5;
export const retryDelayMs = (attempts: number) => 60_000 * 2 ** Math.max(0, attempts - 1);

/** A thread's token in a subject: "[DC-k3x9p2]". */
export const subjectTag = (token: string) => `[DC-${token}]`;
export const TOKEN_IN_SUBJECT = /\[DC-([a-z0-9]{6,16})\]/i;
export const TOKEN_IN_ADDRESS = /\+([a-z0-9]{6,16})@/i;
