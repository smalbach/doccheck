import type { Rule } from '../types';
import { checkRequired, type RequiredField } from './completeness';
import { importerId } from './importer';

/**
 * Invoice details an import declaration in HMRC's Customs Declaration Service is completed from, by
 * data element of the CDS import completion guide (UK Tariff volume 3). HMRC publishes no list of
 * mandatory invoice fields; the invoice is the evidence of the transaction value (Method 1).
 */
export const GB_REQUIRED: RequiredField[] = [
  { path: 'seller.name', label: 'Seller name and address', ref: 'CDS DE 3/24', severity: 'HIGH' },
  { path: 'buyer.name', label: 'Buyer name and address', ref: 'CDS DE 3/26', severity: 'HIGH' },
  { path: 'buyer.taxId', label: 'Importer EORI number', ref: 'CDS DE 3/16', severity: 'HIGH', present: (inv) => !!importerId(inv) },
  { path: 'incoterm', label: 'Delivery terms (Incoterm and location)', ref: 'CDS DE 4/1', severity: 'MEDIUM', present: (inv) => !!inv.incoterm?.code && !!inv.incoterm.place?.trim() },
  { path: 'lines[*].description', label: 'Description of goods', ref: 'CDS DE 6/8', severity: 'HIGH' },
  { path: 'lines[*].hsCode', label: 'Commodity code', ref: 'CDS DE 6/14', severity: 'MEDIUM' },
  { path: 'lines[*].lineTotal.amount', label: 'Item price', ref: 'CDS DE 4/14', severity: 'HIGH' },
  { path: 'currency', label: 'Invoice currency', ref: 'CDS DE 4/10', severity: 'HIGH' },
  { path: 'lines[*].countryOfOrigin', label: 'Country of non-preferential origin', ref: 'CDS DE 5/15', severity: 'HIGH' },
];

/** K1: the invoice carries what an HMRC import declaration in CDS is completed from. */
export const k1GbInvoiceFields: Rule = {
  definition: {
    id: 'K1',
    title: 'Commercial invoice has the details an HMRC (CDS) import declaration needs',
    appliesTo: ['GB'],
    requires: ['COMMERCIAL_INVOICE'],
    kind: 'COMPLETENESS',
    severity: 'HIGH',
  },
  run: (ctx) => checkRequired(ctx, GB_REQUIRED, 'HMRC'),
};
