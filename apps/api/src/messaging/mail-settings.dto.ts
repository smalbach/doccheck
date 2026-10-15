import { z } from 'zod';

const Host = z.string().trim().min(1).max(253).regex(/^[a-z0-9.-]+$/i, 'Expected a host name');
const Port = z.coerce.number().int().min(1).max(65535);
const Address = z.string().trim().max(320);

/** The mail server as an admin enters it. An empty password keeps the saved one. */
export const MailServerDto = z.object({
  smtp: z
    .object({ host: Host, port: Port, secure: z.boolean(), user: z.string().trim().max(320).default(''), password: z.string().max(500).optional() })
    .nullable(),
  /** "Name <address>" or an address. */
  from: Address.min(3).refine((v) => /@[^@\s>]+\.[^@\s>]+>?$/.test(v), 'Expected an address, or Name <address>'),
  replyTo: z.string().trim().toLowerCase().email().max(320).nullable(),
  plusAddressing: z.boolean().default(true),
  imap: z
    .object({
      host: Host,
      port: Port,
      secure: z.boolean(),
      user: z.string().trim().min(1).max(320),
      password: z.string().max(500).optional(),
      mailbox: z.string().trim().min(1).max(200).default('INBOX'),
      pollSeconds: z.coerce.number().int().min(15).max(3600).default(60),
    })
    .nullable(),
  intake: z.object({ enabled: z.boolean().default(false), notifySender: z.boolean().default(true) }).default({ enabled: false, notifySender: true }),
});
export type MailServerDto = z.infer<typeof MailServerDto>;

export const MailTestDto = z.object({
  kind: z.enum(['smtp', 'imap']),
  /** Values not saved yet; the saved passwords fill in empty ones. Absent: test what is saved. */
  config: MailServerDto.optional(),
});
export type MailTestDto = z.infer<typeof MailTestDto>;
