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
import { t10DangerousGoods } from './rules/t10-dangerous-goods';
import { t11WoodPackaging } from './rules/t11-wood-packaging';
import { t12ArrivalNotice } from './rules/t12-arrival-notice';
import { t13SignatureStamp } from './rules/t13-signature-stamp';
import { t1AwbCheckDigit } from './rules/t1-awb-check-digit';
import { t2AwbPieces } from './rules/t2-awb-pieces';
import { t3AwbWeight } from './rules/t3-awb-weight';
import { t4AwbConsignee, t5AwbShipmentDate, t6AwbFreightTerms } from './rules/t4-t6-air-waybill';
import { t7OriginParties } from './rules/t7-origin-parties';
import { t8OriginGoods } from './rules/t8-origin-goods';
import { t9CusmaElements } from './rules/t9-cusma-elements';
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
  // Other freight documents: air waybill, certificates of origin, dangerous goods, wood packaging, arrival notice.
  t1AwbCheckDigit,
  t2AwbPieces,
  t3AwbWeight,
  t4AwbConsignee,
  t5AwbShipmentDate,
  t6AwbFreightTerms,
  t7OriginParties,
  t8OriginGoods,
  t9CusmaElements,
  t10DangerousGoods,
  t11WoodPackaging,
  t12ArrivalNotice,
  t13SignatureStamp,
];
