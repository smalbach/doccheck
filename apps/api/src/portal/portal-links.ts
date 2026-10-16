import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { PortalRepository } from './portal.repository';
import { linkToken, tokenHash } from './portal-token';
import type { PortalKind } from './portal.types';

/** How long a new link works, unless the importer says (PORTAL_LINK_DAYS, at most 90). */
export const linkDays = () => {
  const n = Number(process.env.PORTAL_LINK_DAYS ?? 30);
  return Number.isFinite(n) && n >= 1 ? Math.min(90, Math.floor(n)) : 30;
};

/** Opens a request with its first link, inside the transaction that makes its conversation. */
export async function openPortalRequest(
  repo: PortalRepository,
  db: PoolClient,
  input: { userId: string; kind: PortalKind; shipmentId: string; partyId?: string; supplierName?: string; threadId: string; reference?: string; language?: string; fingerprints: string[]; days?: number },
): Promise<{ requestId: string; linkId: string }> {
  const requestId = randomUUID();
  await repo.insertRequest({ id: requestId, ...input }, db);
  const linkId = await insertLink(repo, db, requestId, input.userId, input.days);
  return { requestId, linkId };
}

export async function insertLink(repo: PortalRepository, db: PoolClient, requestId: string, userId: string, days = linkDays()): Promise<string> {
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + days * 86_400_000).toISOString();
  await repo.insertLink({ id, requestId, tokenHash: tokenHash(linkToken(id)), createdBy: userId, expiresAt }, db);
  await repo.event({ id: randomUUID(), requestId, linkId: id, kind: 'link_created', detail: { expiresAt } }, db);
  return id;
}

