import type { OrgPermission } from '../orgs/permissions';

/**
 * Integration objects (API keys, webhooks, chat alerts, ingestion sources, tracking settings) belong
 * to an organization (docs/ORGANIZATIONS.md); managing them needs `integrations.manage`. An API key
 * acts in its organization with the permissions its scopes give, never more.
 */
export type ApiScope = 'read' | 'write';
export const API_SCOPES: readonly ApiScope[] = ['read', 'write'];

/** What each scope of an API key allows, in the terms of the role table (PERMISSIONS). */
export const SCOPE_PERMISSIONS: Record<ApiScope, readonly OrgPermission[]> = {
  read: ['shipment.read', 'data.read'],
  write: ['shipment.write'],
};

export const permissionsOfScopes = (scopes: readonly ApiScope[]): OrgPermission[] => [...new Set(scopes.flatMap((s) => SCOPE_PERMISSIONS[s]))];

/** Who is calling the public API: the organization, and the key it used. */
export interface ApiPrincipal {
  orgId: string;
  orgName: string;
  keyId: string;
  keyPrefix: string;
  scopes: ApiScope[];
  permissions: OrgPermission[];
  /** The member who made the key (null once they left): shipments the key creates are recorded as theirs. */
  actingUserId: string | null;
}

/** Request augmented by ApiKeyGuard. */
export interface ApiRequest {
  principal?: ApiPrincipal;
}
