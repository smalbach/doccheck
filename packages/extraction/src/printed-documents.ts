import type { CertificateOfOrigin, CusmaCertification, DangerousGoodsDeclaration, AirWaybill } from '@doccheck/schemas';
import type { ExtractableType, ExtractedDocument } from './extract';
import type { PdfText } from './pdf-text';
import { printedUnderLabel } from './printed';
import type { RawAirWaybill, RawCertificateOfOrigin, RawCusmaCertification, RawDangerousGoods } from './raw-schemas-documents';

/**
 * printed.ts for the other documents: values a model tends to fill in although the paper leaves them
 * blank, kept only when the PDF prints them where they belong. Most are what a rule then reports
 * missing: a CUSMA element (T9), the origin of a chamber certificate (T8), a packing group. Each
 * check reads the raw value as printed, so a name or a code is looked for the way it is written.
 * Text-layer documents only, for the reason given in printed.ts.
 */

const squash = (s: string) => s.toUpperCase().replace(/\s+/g, ' ').trim();
/** The raw value appears on the page as is (case and spacing aside). */
const verbatim = (pdf: PdfText, value: string | null | undefined) => !!value && pdf.lines.some((l) => squash(l.text).includes(squash(value)));

const label = (re: RegExp, below: number) => ({ label: re, below });
const EXPORTER = label(/\bexporter\b/i, 8);
const PRODUCER = label(/\b(producer|manufacturer)\b/i, 8);
const IMPORTER = label(/\bimporter\b/i, 8);
const CERTIFIER = label(/\bcertifier\b/i, 8);
const ORIGIN = label(/\b(country of origin|origin of the goods|origin)\b/i, 40);
const CRITERION = label(/\b(origin criteri(on|a)|criterion)\b/i, 40);
const BLANKET = label(/\bblanket\b/i, 4);
const SIGNED = label(/\b(signature|signed|date)\b/i, 6);
const PACKING_GROUP = label(/\b(packing group|PG)\b/i, 30);
/** A role ticked in a list of boxes: "☒ Exporter", "[X] Producer", or "Certifier: Importer". */
const ticked = (pdf: PdfText, role: string) =>
  pdf.lines.some((l) => new RegExp(`(☒|☑|✔|✓|■|\\[\\s*X\\s*\\]|\\(\\s*X\\s*\\))\\s*${role}\\b`, 'i').test(l.text)) ||
  printedUnderLabel(pdf, role, label(/\b(certifier role|certified by|certification by|role)\b/i, 1));

export function dropUnprintedValues(type: ExtractableType, data: ExtractedDocument, raw: unknown, pdf: PdfText): string[] {
  if (pdf.ocrPages?.length) return [];
  const issues: string[] = [];
  const drop = (field: string, value: unknown, where: string, remove: () => void) => {
    issues.push(`${field}: ${JSON.stringify(value)} is not printed ${where}; dropped`);
    remove();
  };

  if (type === 'CUSMA_CERTIFICATION') {
    const c = data as CusmaCertification;
    const r = raw as RawCusmaCertification;
    if (c.certifierRole && !ticked(pdf, r.certifierRole ?? c.certifierRole)) drop('certifierRole', r.certifierRole, 'as the ticked role', () => delete c.certifierRole);
    for (const [key, field] of [['certifier', CERTIFIER], ['exporter', EXPORTER], ['producer', PRODUCER], ['importer', IMPORTER]] as const) {
      const p = c[key];
      if (p && !printedUnderLabel(pdf, p.name, field)) drop(`${key}.name`, p.name, `under a ${key} label`, () => delete c[key]);
    }
    c.goods.forEach((g, i) => {
      const printed = r.goods[i]?.originCriterion;
      if (g.originCriterion && !printedUnderLabel(pdf, printed ?? g.originCriterion, CRITERION)) drop(`goods[${i}].originCriterion`, printed, 'under an origin criterion label', () => delete g.originCriterion);
    });
    if (c.blanketPeriod && !(printedUnderLabel(pdf, r.blanketFrom ?? '', BLANKET) || verbatim(pdf, r.blanketFrom))) drop('blanketPeriod', r.blanketFrom, 'next to a blanket period label', () => delete c.blanketPeriod);
    if (c.signature?.date && !(verbatim(pdf, r.signatureDate) && printedUnderLabel(pdf, r.signatureDate ?? '', SIGNED))) drop('signature.date', r.signatureDate, 'next to the signature', () => delete c.signature!.date);
  }

  if (type === 'CERTIFICATE_OF_ORIGIN') {
    const c = data as CertificateOfOrigin;
    const r = raw as RawCertificateOfOrigin;
    if (c.countryOfOrigin && !printedUnderLabel(pdf, r.countryOfOrigin ?? c.countryOfOrigin, ORIGIN)) drop('countryOfOrigin', r.countryOfOrigin, 'under an origin label', () => delete c.countryOfOrigin);
    if (c.producer && !printedUnderLabel(pdf, c.producer.name, PRODUCER)) drop('producer.name', c.producer.name, 'under a producer label', () => delete c.producer);
  }

  if (type === 'DANGEROUS_GOODS_DECLARATION') {
    const d = data as DangerousGoodsDeclaration;
    const r = raw as RawDangerousGoods;
    d.items.forEach((it, i) => {
      const printed = r.items[i]?.packingGroup;
      if (it.packingGroup && !(printedUnderLabel(pdf, printed ?? it.packingGroup, PACKING_GROUP) || verbatim(pdf, `PG ${it.packingGroup}`))) {
        drop(`items[${i}].packingGroup`, printed, 'under a packing group label', () => delete it.packingGroup);
      }
    });
  }

  if (type === 'AIR_WAYBILL') {
    const a = data as AirWaybill;
    const r = raw as RawAirWaybill;
    // A chargeable weight the model worked out from the dimensions is not on the paper.
    if (a.chargeableWeight && !verbatim(pdf, r.chargeableWeight?.value)) drop('chargeableWeight', r.chargeableWeight?.value, 'on the waybill', () => delete a.chargeableWeight);
  }
  return issues;
}
