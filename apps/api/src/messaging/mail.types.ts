export type ThreadStatus = 'awaiting' | 'replied' | 'closed';
export type ThreadKind = 'correction_request' | 'conversation' | 'intake';
export type MessageStatus = 'queued' | 'sending' | 'sent' | 'failed' | 'received';

export interface MailAttachment {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  /** The shipment document made from it, once imported. */
  documentId?: string;
}

export interface MailMessage {
  id: string;
  threadId?: string;
  direction: 'out' | 'in';
  status: MessageStatus;
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  text: string;
  attempts: number;
  error?: string;
  /** smtp, or log when no SMTP server is configured (captured, not delivered). */
  transport?: string;
  userName?: string;
  sentAt?: string;
  receivedAt?: string;
  readAt?: string;
  /** The receiving server reported a failed DMARC, DKIM or SPF check: the From may be forged. */
  senderUnverified?: boolean;
  /** Uploaded by the supplier through the portal (docs/PORTAL.md), not emailed. */
  viaPortal?: boolean;
  createdAt: string;
  attachments: MailAttachment[];
}

export interface ThreadSummary {
  id: string;
  kind: ThreadKind;
  status: ThreadStatus;
  subject: string;
  shipmentId?: string;
  shipmentReference?: string;
  partyId?: string;
  partyName?: string;
  unread: number;
  /** Awaiting a reply past due_at. */
  overdue: boolean;
  dueAt?: string;
  /** An outgoing message of the thread failed for good. */
  failed: boolean;
  /** Someone in the conversation besides us: the first recipient, or the sender of the latest reply. */
  counterpart?: string;
  /** The start of the latest message's text, for the list. */
  snippet?: string;
  /** Who wrote the latest message: the other side (in) or us (out). */
  lastDirection?: 'in' | 'out';
  /** Some message of the thread carries files. */
  hasAttachments: boolean;
  lastMessageAt: string;
  createdAt: string;
  messages: number;
}

export interface ThreadDetail extends ThreadSummary {
  language?: string;
  /** Where the other side's replies go (with this thread's +token). */
  replyTo: string;
  fingerprints: string[];
  messages: number;
  items: MailMessage[];
  /** Documents by email: what happened to the PDFs of each received message. */
  intakes?: import('./mail-intake.service').IntakeView[];
}

export interface MailSummary {
  unread: number;
  awaiting: number;
  overdue: number;
  failed: number;
  /** Admins only: received messages no thread claimed. */
  unassigned?: number;
}
