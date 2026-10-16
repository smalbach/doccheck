/** A match an organization set aside as a false positive, with its audit trail. */
export interface AllowlistItem {
  id: string;
  orgId: string;
  /** Name of the organization the entry belongs to. */
  organization: string;
  partyName: string;
  partyKey: string;
  list: string;
  entryId: string;
  entryName: string;
  reason: string;
  createdAt: string;
  createdBy?: string;
  removedAt?: string;
  removedBy?: string;
  removedReason?: string;
}
