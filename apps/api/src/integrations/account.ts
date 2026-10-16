import type { PublicUser } from '../auth/auth.types';

/**
 * The account integration objects belong to (API keys, webhooks, chat alerts, ingestion sources,
 * tracking settings) and whose shipments an API key reaches.
 *
 * Today an account is a user: the account id is the user's id, and an account's shipments are the
 * user's. When organizations land, this is the one place to change: return the user's organization
 * id here, make `ownsShipment` check the organization, and repoint the account_id foreign keys of
 * migration 019 (see its header).
 */
export function accountOf(user: Pick<PublicUser, 'id'>): string {
  return user.id;
}

export type ApiScope = 'read' | 'write';
export const API_SCOPES: readonly ApiScope[] = ['read', 'write'];

/** Who is calling the public API: the account, and the key it used. */
export interface ApiPrincipal {
  accountId: string;
  keyId: string;
  scopes: ApiScope[];
  /**
   * The user that owns the shipments the key creates. Equal to the account today; with
   * organizations, the key's creator (shipments still need a user who owns them).
   */
  actingUserId: string;
}

/** Request augmented by ApiKeyGuard. */
export interface ApiRequest {
  principal?: ApiPrincipal;
}
