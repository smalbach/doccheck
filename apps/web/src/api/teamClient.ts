import { jsonBody } from './jsonBody';
import { queryString } from './queryString';
import { request } from './request';
import type { User } from './types';
import type {
  AppNotification, AuditQuery, AuditRow, Comment, CommentTargetKind, Invite, Member, MfaStatus, NotificationPrefs, OrgRole, OrgSettings, OrgSummary, Person, ReviewRequest, SessionInfo,
  ShipmentCollab, SsoConfig, SsoInput,
} from './teamTypes';

const shipmentPath = (id: string) => `/shipments/${encodeURIComponent(id)}`;

/** The organization, collaboration, audit and sign-in calls (kept apart from client.ts). */
export const teamApi = {
  orgs: () => request<{ active?: OrgSummary; items: OrgSummary[] }>('/orgs'),
  createOrg: (name: string) => request<OrgSummary>('/orgs', jsonBody({ name })),
  switchOrg: (id: string) => request<OrgSummary>(`/orgs/${encodeURIComponent(id)}/switch`, { method: 'POST' }),
  currentOrg: () => request<OrgSummary & { settings: OrgSettings }>('/orgs/current'),
  updateOrg: (body: Partial<OrgSettings>) => request<OrgSettings>('/orgs/current', { ...jsonBody(body), method: 'PATCH' }),
  deleteOrg: () => request<void>('/orgs/current', { method: 'DELETE' }),
  members: () => request<Member[]>('/orgs/current/members'),
  setRole: (userId: string, role: OrgRole) => request<Member[]>(`/orgs/current/members/${encodeURIComponent(userId)}`, { ...jsonBody({ role }), method: 'PATCH' }),
  removeMember: (userId: string) => request<void>(`/orgs/current/members/${encodeURIComponent(userId)}`, { method: 'DELETE' }),
  invites: () => request<Invite[]>('/orgs/current/invites'),
  invite: (email: string, role: OrgRole) => request<Invite>('/orgs/current/invites', jsonBody({ email, role })),
  revokeInvite: (id: string) => request<void>(`/orgs/current/invites/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  peekInvite: (token: string) => request<{ orgName: string; role: OrgRole; emailDomain: string }>(`/orgs/invites/${encodeURIComponent(token)}`),
  acceptInvite: (token: string) => request<{ orgId: string; orgName: string }>('/orgs/invites/accept', jsonBody({ token })),
  retentionPreview: () => request<{ expired: number }>('/orgs/current/retention'),
  runRetention: () => request<{ deleted: number; skipped: number }>('/orgs/current/retention/run', { method: 'POST' }),
  sso: () => request<SsoConfig>('/orgs/current/sso'),
  saveSso: (body: SsoInput) => request<SsoConfig>('/orgs/current/sso', { ...jsonBody(body), method: 'PUT' }),
  removeSso: () => request<void>('/orgs/current/sso', { method: 'DELETE' }),
  ssoDiscover: (email: string) => request<{ sso: boolean; orgId?: string; orgName?: string }>(`/auth/sso/discover${queryString({ email })}`),

  shares: (id: string) => request<{ userId: string; name: string; email: string }[]>(`${shipmentPath(id)}/shares`),
  share: (id: string, userId: string) => request<{ userId: string; name: string; email: string }[]>(`${shipmentPath(id)}/shares`, jsonBody({ userId })),
  unshare: (id: string, userId: string) => request<{ userId: string; name: string; email: string }[]>(`${shipmentPath(id)}/shares/${encodeURIComponent(userId)}`, { method: 'DELETE' }),

  collab: (id: string) => request<ShipmentCollab>(`${shipmentPath(id)}/collab`),
  assign: (id: string, userId: string | null) => request<ShipmentCollab>(`${shipmentPath(id)}/assignee`, { ...jsonBody({ userId }), method: 'PUT' }),
  assignFindings: (id: string, fingerprints: string[], userId: string | null) =>
    request<ShipmentCollab>(`${shipmentPath(id)}/findings/assignee`, { ...jsonBody({ fingerprints, userId }), method: 'PUT' }),
  schedule: (id: string, body: { eta?: string | null; dueAt?: string | null }) => request<ShipmentCollab>(`${shipmentPath(id)}/schedule`, { ...jsonBody(body), method: 'PUT' }),
  comments: (id: string, targetKind?: CommentTargetKind, targetId?: string) => request<Comment[]>(`${shipmentPath(id)}/comments${queryString({ targetKind, targetId })}`),
  addComment: (id: string, body: { targetKind: CommentTargetKind; targetId: string; body: string; mentions: string[] }) => request<Comment[]>(`${shipmentPath(id)}/comments`, jsonBody(body)),
  editComment: (id: string, commentId: string, body: { body: string; mentions: string[] }) =>
    request<Comment[]>(`${shipmentPath(id)}/comments/${encodeURIComponent(commentId)}`, { ...jsonBody(body), method: 'PATCH' }),
  deleteComment: (id: string, commentId: string) => request<void>(`${shipmentPath(id)}/comments/${encodeURIComponent(commentId)}`, { method: 'DELETE' }),
  decideApproval: (id: string, requestId: string, decision: 'approved' | 'rejected', note?: string) =>
    request<ShipmentCollab>(`${shipmentPath(id)}/approvals/${encodeURIComponent(requestId)}`, jsonBody({ decision, ...(note ? { note } : {}) })),
  approvals: () => request<ReviewRequest[]>('/approvals'),

  notifications: (unread = false) => request<{ items: AppNotification[]; unread: number }>(`/notifications${unread ? '?unread=true' : ''}`),
  readNotifications: (ids: string[] | 'all') => request<void>('/notifications/read', jsonBody({ ids })),
  notificationPrefs: () => request<NotificationPrefs>('/notifications/prefs'),
  setNotificationPrefs: (prefs: Partial<NotificationPrefs>) => request<NotificationPrefs>('/notifications/prefs', { ...jsonBody(prefs), method: 'PUT' }),

  audit: (query: AuditQuery) => request<{ items: AuditRow[]; total: number; limit: number; offset: number }>(`/audit${queryString({ ...query })}`),
  auditCsvUrl: (query: AuditQuery) => `/audit/log.csv${queryString({ ...query, limit: undefined, offset: undefined })}`,
  verifyAudit: () => request<{ rows: number; intact: boolean; firstBroken: number | null }>('/audit/verify'),

  loginWithCode: (ticket: string, code: string) => request<User>('/auth/mfa', jsonBody({ ticket, code })),
  mfa: () => request<MfaStatus>('/auth/mfa'),
  mfaSetup: () => request<{ secret: string; otpauthUrl: string }>('/auth/mfa/setup', { method: 'POST' }),
  mfaEnable: (code: string) => request<{ recoveryCodes: string[] }>('/auth/mfa/enable', jsonBody({ code })),
  mfaDisable: (password: string, code: string) => request<void>('/auth/mfa/disable', jsonBody({ password, code })),
  mfaRecoveryCodes: (code: string) => request<{ recoveryCodes: string[] }>('/auth/mfa/recovery-codes', jsonBody({ code })),
  sessions: () => request<SessionInfo[]>('/auth/sessions'),
  revokeSession: (id: string) => request<void>(`/auth/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};

export type { Person };
