import type { Rule } from '../types';
import { checkRequired, type RequiredField } from './completeness';
import { importerId } from './importer';

/**
 * Invoice data an EU customs declaration for release for free circulation is built from: the data
 * elements of Annex B to Delegated Regulation (EU) 2015/2446 (column H1) that come from the commercial
 * invoice. The transaction value they feed is defined by Articles 70 and 71 of the Union Customs Code.
 */
export const EU_REQUIRED: RequiredField[] = [
  { path: 'seller.name', label: 'Seller name and address', ref: 'Annex B D.E. 13 08 000 000', severity: 'HIGH' },
  { path: 'buyer.name', label: 'Buyer name and address', ref: 'Annex B D.E. 13 09 000 000', severity: 'HIGH' },
  { path: 'buyer.taxId', label: 'Importer identification number (EORI)', ref: 'Annex B D.E. 13 04 017 000', severity: 'HIGH', present: (inv) => !!importerId(inv) },
  { path: 'incoterm', label: 'Delivery terms (INCOTERM code and place)', ref: 'Annex B D.E. 14 01 000 000', severity: 'MEDIUM', present: (inv) => !!inv.incoterm?.code && !!inv.incoterm.place?.trim() },
  { path: 'lines[*].description', label: 'Description of goods', ref: 'Annex B D.E. 18 05 000 000', severity: 'HIGH' },
  { path: 'lines[*].lineTotal.amount', label: 'Item amount invoiced', ref: 'Annex B D.E. 14 08 000 000', severity: 'HIGH' },
  { path: 'lines[*].countryOfOrigin', label: 'Country of origin', ref: 'Annex B D.E. 16 08 000 000', severity: 'HIGH' },
  { path: 'currency', label: 'Invoice currency', ref: 'Annex B D.E. 14 05 000 000', severity: 'HIGH' },
  { path: 'invoiceTotal.amount', label: 'Total amount invoiced', ref: 'Annex B D.E. 14 06 000 000', severity: 'HIGH' },
];

/** E1: the invoice carries the data the EU customs declaration needs. */
export const e1EuInvoiceFields: Rule = {
  definition: {
    id: 'E1',
    title: 'Commercial invoice has the data an EU customs declaration needs',
    appliesTo: ['EU'],
    requires: ['COMMERCIAL_INVOICE'],
    kind: 'COMPLETENESS',
    severity: 'HIGH',
  },
  run: (ctx) => checkRequired(ctx, EU_REQUIRED, 'UCC'),
};
