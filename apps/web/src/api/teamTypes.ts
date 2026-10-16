/** Types of the organization, collaboration, audit and sign-in routes (docs/ORGANIZATIONS.md). */

export const ORG_ROLES = ['owner', 'admin', 'analyst', 'reviewer', 'viewer', 'client'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];
export const ASSIGNABLE_ROLES = ['admin', 'analyst', 'reviewer', 'viewer', 'client'] as const;

export type OrgPermission =
  | 'shipment.read'
  | 'data.read'
  | 'shipment.write'
  | 'finding.decide'
  | 'finding.approve'
  | 'comment.write'
  | 'assign'
  | 'members.manage'
  | 'org.settings'
  | 'audit.read'
  | 'integrations.manage'
  | 'org.delete';

export interface OrgSummary {
  id: string;
  name: string;
  personal: boolean;
  role: OrgRole;
  members: number;
  permissions: OrgPermission[];
}

export interface OrgSettings {
  name: string;
  retentionCaYears: number;
  retentionUsYears: number;
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

export interface SsoConfig {
  enabled: boolean;
  issuer?: string;
  clientId?: string;
  hasSecret?: boolean;
  emailDomains?: string[];
  defaultRole?: 'admin' | 'analyst' | 'reviewer' | 'viewer';
  redirectUri?: string;
}

export interface SsoInput {
  enabled: boolean;
  issuer: string;
  clientId: string;
  clientSecret?: string;
  emailDomains: string[];
  defaultRole: 'admin' | 'analyst' | 'reviewer' | 'viewer';
}

export interface Person {
  id: string;
  name: string;
}

export interface ReviewRequest {
  id: string;
  fingerprint: string;
  ruleId: string;
  status: 'accepted' | 'false_positive';
  note: string;
  requestedBy?: Person;
  createdAt: string;
  shipmentId?: string;
  reference?: string;
}

export type DueSource = 'manual' | 'isf' | 'eta';

export interface ShipmentCollab {
  assignee?: Person;
  eta?: string;
  manualDueAt?: string;
  due?: { at: string; source: DueSource };
  requireApproval: boolean;
  findingAssignees: Record<string, Person>;
  pendingApprovals: ReviewRequest[];
  /** "finding:<fingerprint>", "document:<id>", "shipment:" → count. */
  commentCounts: Record<string, number>;
}

export type CommentTargetKind = 'shipment' | 'finding' | 'document';

export interface Comment {
  id: string;
  targetKind: CommentTargetKind;
  targetId: string;
  author?: Person;
  body: string;
  mentions: Person[];
  createdAt: string;
  editedAt?: string;
  deleted: boolean;
}

export type NotificationKind = 'mention' | 'assignment' | 'approval_requested' | 'approval_decided';
export const NOTIFICATION_KINDS: readonly NotificationKind[] = ['mention', 'assignment', 'approval_requested', 'approval_decided'];

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  orgId?: string;
  orgName?: string;
  shipmentId?: string;
  reference?: string;
  actorName?: string;
  detail: { excerpt?: string; decision?: 'approved' | 'rejected'; count?: number; target?: string; targetKind?: CommentTargetKind; targetId?: string };
  read: boolean;
  createdAt: string;
}

export type NotificationPrefs = Record<NotificationKind, { inApp: boolean; email: boolean }>;

export interface AuditRow {
  id: number;
  at: string;
  userId?: string;
  userEmail?: string;
  action: string;
  entity?: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  ip?: string;
  hash: string;
}

export interface AuditQuery {
  action?: string;
  userId?: string;
  q?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface SessionInfo {
  id: string;
  current: boolean;
  method: 'password' | 'sso' | 'reset';
  ip?: string;
  userAgent?: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
}

export interface MfaStatus {
  enabled: boolean;
  recoveryCodesLeft: number;
}
