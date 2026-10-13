import type { Rule } from '../types';
import { checkRequired, type RequiredField } from './completeness';

/**
 * Fields CBSA expects on a commercial invoice used instead of form CI1 (Memorandum D1-4-1).
 * Exporter (19) and originator (20) are only needed when they differ from the vendor, and
 * country of transshipment (6) only when there is one, so they are not checked here.
 */
export const CA_REQUIRED: RequiredField[] = [
  { path: 'seller.name', label: 'Vendor name and address', ref: 'CI1 field 1', severity: 'HIGH' },
  { path: 'shipmentDate', label: 'Date of direct shipment to Canada', ref: 'CI1 field 2', severity: 'MEDIUM' },
  { path: 'invoiceNumber', label: 'Invoice number', ref: 'CI1 field 3', severity: 'MEDIUM' },
  { path: 'consignee.name', label: 'Consignee name and address', ref: 'CI1 field 4', severity: 'HIGH' },
  { path: 'buyer.name', label: 'Purchaser name and address', ref: 'CI1 field 5', severity: 'MEDIUM' },
  { path: 'lines[*].countryOfOrigin', label: 'Country of origin', ref: 'CI1 field 7', severity: 'HIGH' },
  { path: 'transport.mode', label: 'Transportation mode and place of direct shipment', ref: 'CI1 field 8', severity: 'MEDIUM' },
  { path: 'incoterm', label: 'Conditions of sale (terms of sale)', ref: 'CI1 field 9', severity: 'MEDIUM' },
  { path: 'currency', label: 'Currency of settlement', ref: 'CI1 field 10', severity: 'HIGH' },
  { path: 'packageCount', label: 'Number of packages', ref: 'CI1 field 11', severity: 'MEDIUM' },
  { path: 'lines[*].description', label: 'Description of goods', ref: 'CI1 field 12', severity: 'HIGH' },
  { path: 'lines[*].quantity.value', label: 'Quantity', ref: 'CI1 field 13', severity: 'HIGH' },
  { path: 'lines[*].unitPrice.amount', label: 'Unit price', ref: 'CI1 field 14', severity: 'HIGH' },
  { path: 'invoiceTotal.amount', label: 'Invoice total', ref: 'CI1 field 17', severity: 'HIGH' },
  {
    path: 'netWeight.kg',
    label: 'Net and gross weight',
    ref: 'CI1 field 16',
    severity: 'LOW',
    present: (inv) => !!inv.netWeight && !!inv.grossWeight,
  },
];

/** C1: the invoice carries every field CBSA requires. */
export const c1CaInvoiceFields: Rule = {
  definition: {
    id: 'C1',
    title: 'Commercial invoice has the fields CBSA requires',
    appliesTo: ['CA'],
    requires: ['COMMERCIAL_INVOICE'],
    kind: 'COMPLETENESS',
    severity: 'HIGH',
  },
  run: (ctx) => checkRequired(ctx, CA_REQUIRED, 'CBSA'),
};
