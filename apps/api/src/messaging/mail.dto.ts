import { z } from 'zod';

const Email = z.string().trim().toLowerCase().email('Not an email address').max(254);
const page = {
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).default(0),
};

export const NewThreadDto = z
  .object({
    kind: z.enum(['correction_request', 'conversation']).default('conversation'),
    shipmentId: z.string().uuid().optional(),
    partyId: z.string().uuid().optional(),
    to: z.array(Email).min(1, 'Add a recipient').max(10),
    cc: z.array(Email).max(10).default([]),
    subject: z.string().trim().min(1).max(300),
    body: z.string().trim().min(1).max(50_000),
    language: z.enum(['en', 'es', 'fr']).optional(),
    /** Findings of the shipment's latest validation the request is about. */
    fingerprints: z.array(z.string().regex(/^[0-9a-f]{32}$/)).max(200).default([]),
    /** A correction request with a supplier portal link (docs/PORTAL.md), put where the text says {{portal-link}}. */
    portal: z.boolean().default(false),
  })
  .refine((d) => d.kind !== 'correction_request' || (d.shipmentId && d.fingerprints.length > 0), {
    message: 'A correction request needs a shipment and at least one finding',
    path: ['fingerprints'],
  });
export type NewThreadDto = z.infer<typeof NewThreadDto>;

/** What a message will look like, before sending it. */
export const PreviewDto = z.object({
  subject: z.string().max(300).default(''),
  body: z.string().max(50_000).default(''),
  language: z.enum(['en', 'es', 'fr']).optional(),
});
export type PreviewDto = z.infer<typeof PreviewDto>;

export const ReplyDto = z.object({
  body: z.string().trim().min(1).max(50_000),
  /** Defaults to whoever wrote last (or the thread's first recipients). */
  to: z.array(Email).min(1).max(10).optional(),
  cc: z.array(Email).max(10).optional(),
});
export type ReplyDto = z.infer<typeof ReplyDto>;

export const ThreadStatusDto = z.object({ status: z.enum(['awaiting', 'closed']) });
export type ThreadStatusDto = z.infer<typeof ThreadStatusDto>;

export const AssignDto = z.object({ threadId: z.string().uuid() });
export type AssignDto = z.infer<typeof AssignDto>;

export const ThreadsQuery = z.object({
  filter: z.enum(['all', 'open', 'unread', 'awaiting', 'overdue', 'failed', 'closed']).default('open'),
  q: z.string().trim().max(200).optional(),
  shipmentId: z.string().uuid().optional(),
  partyId: z.string().uuid().optional(),
  ...page,
});
export type ThreadsQuery = z.infer<typeof ThreadsQuery>;

export const ContactsQuery = z.object({ partyId: z.string().uuid().optional(), shipmentId: z.string().uuid().optional() });
export type ContactsQuery = z.infer<typeof ContactsQuery>;
