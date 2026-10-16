import type { OrgPermission, OrgRole } from './permissions';

/** The organization a request acts in, with the member's role there (set by OrgGuard). */
export interface OrgContext {
  id: string;
  name: string;
  personal: boolean;
  role: OrgRole;
}

export interface OrgSummary extends OrgContext {
  members: number;
  permissions: OrgPermission[];
}

export interface OrgSettings {
  name: string;
  retentionCaYears: number;
  retentionUsYears: number;
  retentionMxYears: number;
  retentionEuYears: number;
  retentionGbYears: number;
  requireApproval: boolean;
  slaEtaLeadHours: number;
}

export interface Member {
  userId: string;
  email: string;
  name: string;
  role: OrgRole;
  mfa: boolean;
  joinedAt: string;
}

export interface Invite {
  id: string;
  email: string;
  role: OrgRole;
  invitedBy?: string;
  createdAt: string;
  expiresAt: string;
}

/** Request augmented by OrgGuard. */
export interface OrgRequest {
  org?: OrgContext;
}
