import type { Rule } from '../types';
import { checkRequired, type RequiredField } from './completeness';
import { importerId } from './importer';

/**
 * Data the foreign invoice ("documento equivalente") must show for a Mexican import: Reglas Generales
 * de Comercio Exterior 2026, regla 3.1.8, fracciones I-VII (for Ley Aduanera artículos 36 and 36-A,
 * fracción I, inciso a)), plus the tax numbers regla 1.9.19 requires in the value data transmitted for
 * the pedimento. Labels carry the Spanish wording of the rule so the citation search finds the fracción.
 */
export const MX_REQUIRED: RequiredField[] = [
  { path: 'invoiceDate', label: 'Place and date of issue (lugar y fecha de expedición)', ref: 'regla 3.1.8, fracción I', severity: 'MEDIUM' },
  {
    path: 'consignee.name',
    label: 'Name and address of the consignee (destinatario de la mercancía)',
    ref: 'regla 3.1.8, fracción II',
    severity: 'HIGH',
    present: (inv) => !!(inv.consignee?.name.trim() || inv.buyer.name.trim()),
  },
  { path: 'lines[*].description', label: 'Detailed commercial description (descripción comercial detallada)', ref: 'regla 3.1.8, fracción III', severity: 'HIGH' },
  { path: 'lines[*].quantity.value', label: 'Quantity of units (cantidad de unidades)', ref: 'regla 3.1.8, fracción III', severity: 'HIGH' },
  { path: 'lines[*].unitPrice.amount', label: 'Unit value (valor unitario)', ref: 'regla 3.1.8, fracción III', severity: 'HIGH' },
  { path: 'lines[*].lineTotal.amount', label: 'Total value of the line (valor total)', ref: 'regla 3.1.8, fracción III', severity: 'MEDIUM' },
  { path: 'seller.name', label: 'Name and address of the supplier or seller (proveedor o vendedor)', ref: 'regla 3.1.8, fracción IV', severity: 'HIGH' },
  { path: 'invoiceNumber', label: 'Document number (número del documento)', ref: 'regla 3.1.8, fracción VI', severity: 'MEDIUM' },
  { path: 'invoiceTotal.amount', label: 'Commercial value of the goods (valor comercial)', ref: 'regla 3.1.8, fracción VII', severity: 'HIGH' },
  { path: 'currency', label: 'Currency of the commercial value (moneda)', ref: 'regla 3.1.8, fracción VII', severity: 'HIGH' },
  { path: 'seller.taxId', label: "Supplier's tax identification number (número de identificación fiscal del proveedor)", ref: 'regla 1.9.19, fracción I, inciso c', severity: 'MEDIUM' },
  { path: 'buyer.taxId', label: "Consignee's RFC (clave en el RFC del destinatario)", ref: 'regla 1.9.19, fracción I, inciso d', severity: 'HIGH', present: (inv) => !!importerId(inv) },
];

/** M1: the invoice carries the data RGCE regla 3.1.8 (and the tax numbers of regla 1.9.19) require. */
export const m1MxInvoiceFields: Rule = {
  definition: {
    id: 'M1',
    title: 'Commercial invoice has the data RGCE regla 3.1.8 requires',
    appliesTo: ['MX'],
    requires: ['COMMERCIAL_INVOICE'],
    kind: 'COMPLETENESS',
    severity: 'HIGH',
  },
  run: (ctx) => checkRequired(ctx, MX_REQUIRED, 'RGCE'),
};
