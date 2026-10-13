import type { Rule } from '../types';
import { checkRequired, type RequiredField } from './completeness';

/** Information 19 CFR 141.86(a) requires on a commercial invoice for US entry. */
export const US_REQUIRED: RequiredField[] = [
  { path: 'portOfEntry.name', label: 'Port of entry', ref: '141.86(a)(1)', severity: 'MEDIUM' },
  { path: 'invoiceDate', label: 'Time of sale (invoice date)', ref: '141.86(a)(2)', severity: 'MEDIUM' },
  { path: 'seller.name', label: 'Seller name and place', ref: '141.86(a)(2)', severity: 'HIGH' },
  { path: 'buyer.name', label: 'Purchaser name and place', ref: '141.86(a)(2)', severity: 'HIGH' },
  { path: 'lines[*].description', label: 'Detailed description of the merchandise', ref: '141.86(a)(3)', severity: 'HIGH' },
  { path: 'lines[*].quantity.value', label: 'Quantity', ref: '141.86(a)(4)', severity: 'HIGH' },
  { path: 'lines[*].unitPrice.amount', label: 'Purchase price of each item', ref: '141.86(a)(5)', severity: 'HIGH' },
  { path: 'currency', label: 'Currency of the purchase price', ref: '141.86(a)(5)', severity: 'HIGH' },
  { path: 'lines[*].countryOfOrigin', label: 'Country of origin', ref: '141.86(a)(10)', severity: 'HIGH' },
];

/** U1: the invoice carries the information 19 CFR 141.86(a) requires. */
export const u1UsInvoiceFields: Rule = {
  definition: {
    id: 'U1',
    title: 'Commercial invoice has the information 19 CFR 141.86 requires',
    appliesTo: ['US'],
    requires: ['COMMERCIAL_INVOICE'],
    kind: 'COMPLETENESS',
    severity: 'HIGH',
  },
  run: (ctx) => checkRequired(ctx, US_REQUIRED, '19 CFR'),
};
