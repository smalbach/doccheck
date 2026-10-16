import type { Location } from '@doccheck/schemas';
import type { ShipmentContext } from '../types';

/** A place a document names, with the path rules cite as evidence. */
export interface NamedPlace {
  documentId: string;
  /** "portOfLoading", "transport.placeOfShipment"... */
  field: string;
  label: string;
  place: Location;
}

/** Every location on the invoice, BL and ISF, in document order. */
export function placesOf(ctx: ShipmentContext): NamedPlace[] {
  const out: NamedPlace[] = [];
  const add = (documentId: string, field: string, label: string, place: Location | undefined) => {
    if (place) out.push({ documentId, field, label, place });
  };
  if (ctx.invoice) {
    const inv = ctx.invoice.data;
    add(ctx.invoice.id, 'transport.placeOfShipment', 'invoice place of direct shipment', inv.transport?.placeOfShipment);
    add(ctx.invoice.id, 'portOfEntry', 'invoice port of entry', inv.portOfEntry);
  }
  if (ctx.billOfLading) {
    const bl = ctx.billOfLading.data;
    add(ctx.billOfLading.id, 'placeOfReceipt', 'BL place of receipt', bl.placeOfReceipt);
    add(ctx.billOfLading.id, 'portOfLoading', 'BL port of loading', bl.portOfLoading);
    add(ctx.billOfLading.id, 'portOfDischarge', 'BL port of discharge', bl.portOfDischarge);
    add(ctx.billOfLading.id, 'placeOfDelivery', 'BL place of delivery', bl.placeOfDelivery);
  }
  if (ctx.isf) {
    add(ctx.isf.id, 'portOfLoading', 'ISF port of loading', ctx.isf.data.portOfLoading);
    add(ctx.isf.id, 'portOfDischarge', 'ISF port of discharge', ctx.isf.data.portOfDischarge);
  }
  return out;
}

export const locode = (p: Location): string | undefined => p.unLocode?.replace(/\s+/g, '').toUpperCase() || undefined;
