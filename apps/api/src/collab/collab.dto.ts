import { z } from 'zod';

const fingerprint = z.string().regex(/^[0-9a-f]{32}$/);

export const CommentTarget = z.discriminatedUnion('targetKind', [
  z.object({ targetKind: z.literal('shipment'), targetId: z.literal('').default('') }),
  z.object({ targetKind: z.literal('finding'), targetId: fingerprint }),
  z.object({ targetKind: z.literal('document'), targetId: z.uuid() }),
]);
export type CommentTarget = z.infer<typeof CommentTarget>;

export const CommentsQuery = z.object({
  targetKind: z.enum(['shipment', 'finding', 'document']).optional(),
  targetId: z.string().max(64).optional(),
});
export type CommentsQuery = z.infer<typeof CommentsQuery>;

/** Mentions are member ids picked in the editor ("@Ada"); ids of non-members are dropped. */
export const NewCommentDto = z.intersection(
  CommentTarget,
  z.object({ body: z.string().trim().min(1, 'Write something').max(5000), mentions: z.array(z.uuid()).max(20).default([]) }),
);
export type NewCommentDto = z.infer<typeof NewCommentDto>;

export const EditCommentDto = z.object({ body: z.string().trim().min(1).max(5000), mentions: z.array(z.uuid()).max(20).default([]) });
export type EditCommentDto = z.infer<typeof EditCommentDto>;

export const AssignDto = z.object({ userId: z.uuid().nullable() });
export type AssignDto = z.infer<typeof AssignDto>;

export const AssignFindingsDto = z.object({ fingerprints: z.array(fingerprint).min(1).max(200), userId: z.uuid().nullable() });
export type AssignFindingsDto = z.infer<typeof AssignFindingsDto>;

/** ETA as a date; dueAt sets the due date by hand (null goes back to the ISF deadline or the ETA). */
export const ScheduleDto = z.object({ eta: z.iso.date().nullable().optional(), dueAt: z.iso.datetime({ offset: true }).nullable().optional() });
export type ScheduleDto = z.infer<typeof ScheduleDto>;

export const ApprovalDto = z
  .object({ decision: z.enum(['approved', 'rejected']), note: z.string().trim().max(2000).optional() })
  .refine((d) => d.decision === 'approved' || (d.note ?? '').length >= 3, { message: 'Say why the decision is rejected', path: ['note'] });
export type ApprovalDto = z.infer<typeof ApprovalDto>;

export const ReadNotificationsDto = z.object({ ids: z.union([z.literal('all'), z.array(z.uuid()).max(200)]) });
export type ReadNotificationsDto = z.infer<typeof ReadNotificationsDto>;

const pref = z.object({ inApp: z.boolean(), email: z.boolean() });
export const NotificationPrefsDto = z.object({ mention: pref, assignment: pref, approval_requested: pref, approval_decided: pref }).partial();
export type NotificationPrefsDto = z.infer<typeof NotificationPrefsDto>;
