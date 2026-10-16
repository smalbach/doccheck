import { c1CaInvoiceFields } from './rules/c1-ca-invoice-fields';
import { c2InvoiceLanguage } from './rules/c2-invoice-language';
import { e1EuInvoiceFields } from './rules/e1-eu-invoice-fields';
import { e2EuEori } from './rules/e2-eu-eori';
import { e3Ics2Data } from './rules/e3-ics2-data';
import { k1GbInvoiceFields } from './rules/k1-gb-invoice-fields';
import { k2GbEori } from './rules/k2-gb-eori';
import { k3TcaOriginStatement } from './rules/k3-tca-origin-statement';
import { m1MxInvoiceFields } from './rules/m1-mx-invoice-fields';
import { m2MxRfc } from './rules/m2-mx-rfc';
import { m3MxInvoiceLanguage } from './rules/m3-mx-invoice-language';
import { u1UsInvoiceFields } from './rules/u1-us-invoice-fields';
import { x10ContainerCheckDigit } from './rules/x10-container-check-digit';
import { x11IsfConsistency } from './rules/x11-isf-consistency';
import { x12IncotermFreight } from './rules/x12-incoterm-freight';
import { x1ConsigneeMatch } from './rules/x1-consignee-match';
import { x2PackageCount } from './rules/x2-package-count';
import { x3GrossWeight } from './rules/x3-gross-weight';
import { x4NetVsGross } from './rules/x4-net-vs-gross';
import { x5InvoiceArithmetic } from './rules/x5-invoice-arithmetic';
import { x6SingleCurrency } from './rules/x6-single-currency';
import { x7QuantityMatch } from './rules/x7-quantity-match';
import { x8InvoiceReference } from './rules/x8-invoice-reference';
import { x9ShipmentDate } from './rules/x9-shipment-date';
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
  x9ShipmentDate,
  x10ContainerCheckDigit,
  x11IsfConsistency,
  x12IncotermFreight,
  c1CaInvoiceFields,
  c2InvoiceLanguage,
  u1UsInvoiceFields,
  m1MxInvoiceFields,
  m2MxRfc,
  m3MxInvoiceLanguage,
  e1EuInvoiceFields,
  e2EuEori,
  e3Ics2Data,
  k1GbInvoiceFields,
  k2GbEori,
  k3TcaOriginStatement,
];
