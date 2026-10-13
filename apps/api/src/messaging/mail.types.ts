export type ThreadStatus = 'awaiting' | 'replied' | 'closed';
export type ThreadKind = 'correction_request' | 'conversation';
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
  lastMessageAt: string;
  createdAt: string;
  messages: number;
}

export interface ThreadDetail extends ThreadSummary {
  language?: string;
  fingerprints: string[];
  messages: number;
  items: MailMessage[];
}

export interface MailSummary {
  unread: number;
  awaiting: number;
  overdue: number;
  failed: number;
  /** Admins only: received messages no thread claimed. */
  unassigned?: number;
}
