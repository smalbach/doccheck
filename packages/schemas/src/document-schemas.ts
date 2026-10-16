import type { z } from 'zod';
import { AirWaybill } from './air-waybill';
import { ArrivalNotice } from './arrival-notice';
import { BillOfLading } from './bill-of-lading';
import { CertificateOfOrigin, CusmaCertification } from './certificate-of-origin';
import { CommercialInvoice } from './commercial-invoice';
import type { DocumentType } from './common';
import { DangerousGoodsDeclaration } from './dangerous-goods';
import { Isf } from './isf';
import { PackingList } from './packing-list';
import { WoodPackagingCertificate } from './wood-packaging';

/** The normalized schema of each document type (what extraction produces and a correction must still pass). */
export const DOCUMENT_SCHEMAS = {
  COMMERCIAL_INVOICE: CommercialInvoice,
  PACKING_LIST: PackingList,
  BILL_OF_LADING: BillOfLading,
  ISF: Isf,
  AIR_WAYBILL: AirWaybill,
  CERTIFICATE_OF_ORIGIN: CertificateOfOrigin,
  CUSMA_CERTIFICATION: CusmaCertification,
  ARRIVAL_NOTICE: ArrivalNotice,
  WOOD_PACKAGING_CERTIFICATE: WoodPackagingCertificate,
  DANGEROUS_GOODS_DECLARATION: DangerousGoodsDeclaration,
} as const satisfies Record<Exclude<DocumentType, 'UNKNOWN'>, z.ZodType>;
