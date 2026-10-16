import type { CusmaCertification, Severity } from '@doccheck/schemas';
import type { Rule, RuleResult } from '../types';
import { hs6 } from './t8-origin-goods';

const MAX_BLANKET_DAYS = 366;
const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

interface Element {
  n: number;
  label: string;
  field: string;
  severity: Severity;
  missing: (c: CusmaCertification) => boolean;
}

/**
 * The nine minimum data elements of a CUSMA certification of origin (CUSMA Annex 5-A; CBSA
 * Memorandum D11-4-2 for Canada, 19 CFR 182.12 for the US). Elements that the annex only asks for
 * in some cases are checked in those cases: the exporter when the importer certifies (the exporter
 * certifying is the exporter), the producer unless the producer certifies or the certification says
 * "Various" or "Available upon request", and the importer not at all ("if known").
 */
export const CUSMA_ELEMENTS: Element[] = [
  { n: 1, label: 'Who certifies (importer, exporter or producer)', field: 'certifierRole', severity: 'HIGH', missing: (c) => !c.certifierRole },
  { n: 2, label: 'Certifier name, address and contact', field: 'certifier.name', severity: 'HIGH', missing: (c) => !c.certifier?.name },
  { n: 3, label: 'Exporter name and address', field: 'exporter.name', severity: 'MEDIUM', missing: (c) => c.certifierRole === 'IMPORTER' && !c.exporter?.name },
  { n: 4, label: 'Producer name and address', field: 'producer.name', severity: 'MEDIUM', missing: (c) => c.certifierRole !== 'PRODUCER' && !c.producer?.name && !c.producerStatement },
  { n: 9, label: 'Authorized signature and date', field: 'signature.date', severity: 'HIGH', missing: (c) => !c.signature?.date || !c.signature.name },
];

/** T9: a CUSMA certification has the nine minimum data elements; one finding per missing element. */
export const t9CusmaElements: Rule = {
  definition: {
    id: 'T9',
    title: 'CUSMA certification has the nine minimum data elements',
    appliesTo: 'ALL',
    requires: ['CUSMA_CERTIFICATION'],
    kind: 'COMPLETENESS',
    severity: 'HIGH',
    optional: true,
  },
  run(ctx) {
    if (!ctx.cusmaCertification) return [];
    const { id, data } = ctx.cusmaCertification;
    const results: RuleResult[] = [];
    const missing = (n: number, label: string, field: string, severity: Severity, detail = '') =>
      results.push({
        severity,
        message: `${label} is missing from the CUSMA certification of origin${detail} (CUSMA Annex 5-A, element ${n}).`,
        evidence: [{ documentId: id, field, value: '' }],
        suggestedFix: 'Without every minimum data element the preferential tariff can be denied; ask the certifier for a complete certification.',
      });
    for (const e of CUSMA_ELEMENTS.filter((e) => e.n < 6)) if (e.missing(data)) missing(e.n, e.label, e.field, e.severity);
    if (data.certifier && data.certifier.address.lines.length === 0 && !data.certifier.address.city) missing(2, 'Certifier address', 'certifier.address', 'MEDIUM');

    const noHs = data.goods.map((g, i) => ({ g, i })).filter(({ g }) => !hs6(g.hsCode));
    if (noHs.length) missing(6, 'HS classification to six digits', `goods[${noHs[0].i}].hsCode`, 'HIGH', ` for ${noHs.length === data.goods.length ? 'every good' : `good ${noHs.map((x) => x.i + 1).join(', ')}`}`);
    const noCriterion = data.goods.map((g, i) => ({ g, i })).filter(({ g }) => !g.originCriterion);
    if (noCriterion.length) missing(7, 'Origin criterion (A, B, C or D)', `goods[${noCriterion[0].i}].originCriterion`, 'HIGH', ` for ${noCriterion.length === data.goods.length ? 'every good' : `good ${noCriterion.map((x) => x.i + 1).join(', ')}`}`);

    const blanket = data.blanketPeriod;
    if (blanket) {
      const span = days(blanket.from, blanket.to);
      if (span < 0 || span > MAX_BLANKET_DAYS) {
        results.push({
          severity: 'MEDIUM',
          message: `The blanket period ${blanket.from} to ${blanket.to} ${span < 0 ? 'ends before it starts' : 'is longer than 12 months'} (CUSMA Annex 5-A, element 8).`,
          evidence: [
            { documentId: id, field: 'blanketPeriod.from', value: blanket.from },
            { documentId: id, field: 'blanketPeriod.to', value: blanket.to },
          ],
          suggestedFix: 'A blanket certification covers identical goods for up to 12 months; ask for one with a valid period.',
        });
      }
    }
    for (const e of CUSMA_ELEMENTS.filter((e) => e.n === 9)) if (e.missing(data)) missing(e.n, e.label, e.field, e.severity);
    return results;
  },
};
