/** A match an account set aside as a false positive, with its audit trail. */
export interface AllowlistItem {
  id: string;
  userId: string;
  /** Email of the account the entry belongs to. */
  account: string;
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
