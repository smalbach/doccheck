import type { Shipment } from '../api/types';

/** "doccheck-PO-4411-2026-10-13.json": reference (or id) and today, safe for file systems. */
export function reportFileName(shipment: Shipment, extension: string): string {
  const name = (shipment.reference ?? shipment.id.slice(0, 8)).replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '');
  return `doccheck-${name || 'shipment'}-${new Date().toISOString().slice(0, 10)}.${extension}`;
}
