import { z } from 'zod';
import { ASSIGNABLE_ROLES, ORG_ROLES } from './permissions';

const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: 'Enter a valid email address' }).max(254));

export const CreateOrgDto = z.object({ name: z.string().trim().min(1, 'Name the organization').max(100) });
export type CreateOrgDto = z.infer<typeof CreateOrgDto>;

export const OrgSettingsDto = z
  .object({
    name: z.string().trim().min(1).max(100),
    retentionCaYears: z.number().int().min(1).max(50),
    retentionUsYears: z.number().int().min(1).max(50),
    requireApproval: z.boolean(),
    slaEtaLeadHours: z.number().int().min(0).max(720),
  })
  .partial();
export type OrgSettingsDto = z.infer<typeof OrgSettingsDto>;

export const InviteDto = z.object({ email, role: z.enum(ASSIGNABLE_ROLES) });
export type InviteDto = z.infer<typeof InviteDto>;

export const AcceptInviteDto = z.object({ token: z.string().min(1).max(200) });
export type AcceptInviteDto = z.infer<typeof AcceptInviteDto>;

/** Owner can be given only by an owner. */
export const SetMemberRoleDto = z.object({ role: z.enum(ORG_ROLES) });
export type SetMemberRoleDto = z.infer<typeof SetMemberRoleDto>;

export const ShareDto = z.object({ userId: z.uuid() });
export type ShareDto = z.infer<typeof ShareDto>;

export const SsoConfigDto = z.object({
  enabled: z.boolean(),
  issuer: z.url({ protocol: /^https?$/ }).max(500),
  clientId: z.string().trim().min(1).max(300),
  /** Omitted to keep the saved one. */
  clientSecret: z.string().min(1).max(1000).optional(),
  emailDomains: z.array(z.string().trim().toLowerCase().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, 'A domain like example.com')).max(20).default([]),
  defaultRole: z.enum(['admin', 'analyst', 'reviewer', 'viewer']).default('viewer'),
});
export type SsoConfigDto = z.infer<typeof SsoConfigDto>;
