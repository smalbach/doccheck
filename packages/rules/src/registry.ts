import { c1CaInvoiceFields } from './rules/c1-ca-invoice-fields';
import { c2InvoiceLanguage } from './rules/c2-invoice-language';
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
import { c3BusinessNumber } from './rules/c3-business-number';
import { u2IsfCompleteness } from './rules/u2-isf-completeness';
import { u3IsfTiming } from './rules/u3-isf-timing';
import { u4ImporterNumber } from './rules/u4-importer-number';
import { x13Unlocode } from './rules/x13-unlocode';
import { x14PortCoherence } from './rules/x14-port-coherence';
import { x15VesselCarrier } from './rules/x15-vessel-carrier';
import { x16DateOrder } from './rules/x16-date-order';
import { x17DuplicateInvoice } from './rules/x17-duplicate-invoice';
import { x18UnitsOfMeasure } from './rules/x18-units-of-measure';
import { x19ContainerCapacity } from './rules/x19-container-capacity';
import { x20Vgm } from './rules/x20-vgm';
import { x21BlType } from './rules/x21-bl-type';
import { x22IncotermCharges } from './rules/x22-incoterm-charges';
import { x23PriceHistory } from './rules/x23-price-history';
import { x24PurchaseOrder } from './rules/x24-purchase-order';
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
  // Added after evaluation set v1 (see V1_RULE_IDS).
  x13Unlocode,
  x14PortCoherence,
  x15VesselCarrier,
  x16DateOrder,
  x17DuplicateInvoice,
  x18UnitsOfMeasure,
  x19ContainerCapacity,
  x20Vgm,
  x21BlType,
  x22IncotermCharges,
  x23PriceHistory,
  x24PurchaseOrder,
  c3BusinessNumber,
  u2IsfCompleteness,
  u3IsfTiming,
  u4ImporterNumber,
];

/**
 * The rules evaluation sets v1 and v2 are labeled for. Their injected errors and expected rule ids were
 * frozen before the later rules existed (and their synthetic Business Numbers and SCACs are not real),
 * so the evaluations run these rules only; the later ones are measured on their own set (synth `v1-rules`).
 */
export const V1_RULE_IDS: readonly string[] = ['X1', 'X2', 'X3', 'X4', 'X5', 'X6', 'X7', 'X8', 'X9', 'X10', 'X11', 'X12', 'C1', 'C2', 'U1'];
