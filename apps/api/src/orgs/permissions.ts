import { SetMetadata } from '@nestjs/common';

/** A member's role in an organization (docs/ORGANIZATIONS.md). */
export const ORG_ROLES = ['owner', 'admin', 'analyst', 'reviewer', 'viewer', 'client'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

/** Roles an invitation or a role change can give: ownership is only handed over. */
export const ASSIGNABLE_ROLES = ['admin', 'analyst', 'reviewer', 'viewer', 'client'] as const;

/**
 * What each role may do. The one place permissions are decided: routes name a permission with
 * @Permission() and OrgGuard checks it; a route without one needs data.read for GET and
 * shipment.write for anything else.
 */
export const PERMISSIONS = {
  /** Open a shipment: every role (a client only the shipments shared with them, ShipmentOwnerGuard). */
  'shipment.read': ['owner', 'admin', 'analyst', 'reviewer', 'viewer', 'client'],
  /** Everything else the organization has: all shipments, dashboard, companies, products, conversations. */
  'data.read': ['owner', 'admin', 'analyst', 'reviewer', 'viewer'],
  /** Create, upload, edit, validate, correct values, write to suppliers, set due dates. */
  'shipment.write': ['owner', 'admin', 'analyst'],
  /** Decide about a finding (open, waiting for the supplier, accepted risk, false positive). */
  'finding.decide': ['owner', 'admin', 'analyst', 'reviewer'],
  /** Approve or reject someone else's accepted risk or false positive (two-step approval). */
  'finding.approve': ['owner', 'admin', 'reviewer'],
  'comment.write': ['owner', 'admin', 'analyst', 'reviewer'],
  'assign': ['owner', 'admin', 'analyst', 'reviewer'],
  /** Invite and remove members, change roles, share shipments with clients. */
  'members.manage': ['owner', 'admin'],
  /** Retention, approval policy, due date lead time, SSO. */
  'org.settings': ['owner', 'admin'],
  'audit.read': ['owner', 'admin'],
  'org.delete': ['owner'],
} as const satisfies Record<string, readonly OrgRole[]>;
export type OrgPermission = keyof typeof PERMISSIONS;

export function can(role: OrgRole | undefined, permission: OrgPermission): boolean {
  return !!role && (PERMISSIONS[permission] as readonly OrgRole[]).includes(role);
}

/** Every permission of a role, for the web app to show or hide controls (the API checks again). */
export const permissionsOf = (role: OrgRole): OrgPermission[] => (Object.keys(PERMISSIONS) as OrgPermission[]).filter((p) => can(role, p));

export const PERMISSION = 'doccheck:permission';
export const NO_ORG = 'doccheck:no-org';

/** The permission a route (or every route of a controller) needs in the active organization. */
export const Permission = (permission: OrgPermission) => SetMetadata(PERMISSION, permission);

/** Routes about the user, not an organization (account, sign-in, server administration). */
export const NoOrg = () => SetMetadata(NO_ORG, true);
