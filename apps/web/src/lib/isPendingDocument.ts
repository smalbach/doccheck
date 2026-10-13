import type { ShipmentDocument } from '../api/types';

/** Queued or being extracted: its data is not there yet. */
export function isPendingDocument(doc: Pick<ShipmentDocument, 'status'>): boolean {
  return doc.status === 'QUEUED' || doc.status === 'EXTRACTING';
}
