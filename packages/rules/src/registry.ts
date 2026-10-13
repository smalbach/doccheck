import { c1CaInvoiceFields } from './rules/c1-ca-invoice-fields';
import { c2InvoiceLanguage } from './rules/c2-invoice-language';
import { u1UsInvoiceFields } from './rules/u1-us-invoice-fields';
import { x10ContainerCheckDigit } from './rules/x10-container-check-digit';
import { x11IsfConsistency } from './rules/x11-isf-consistency';
import { x1ConsigneeMatch } from './rules/x1-consignee-match';
import { x2PackageCount } from './rules/x2-package-count';
import { x3GrossWeight } from './rules/x3-gross-weight';
import { x4NetVsGross } from './rules/x4-net-vs-gross';
import { x5InvoiceArithmetic } from './rules/x5-invoice-arithmetic';
import { x6SingleCurrency } from './rules/x6-single-currency';
import { x7QuantityMatch } from './rules/x7-quantity-match';
import { x8InvoiceReference } from './rules/x8-invoice-reference';
import type { Rule } from './types';

export const ALL_RULES: Rule[] = [
  x1ConsigneeMatch,
  x2PackageCount,
  x3GrossWeight,
  x4NetVsGross,
  x5InvoiceArithmetic,
  x6SingleCurrency,
  x7QuantityMatch,
  x8InvoiceReference,
  x10ContainerCheckDigit,
  x11IsfConsistency,
  c1CaInvoiceFields,
  c2InvoiceLanguage,
  u1UsInvoiceFields,
];
