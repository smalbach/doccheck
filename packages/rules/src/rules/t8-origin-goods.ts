import type { Evidence } from '@doccheck/schemas';
import type { Rule, RuleResult } from '../types';

/** First six digits of an HS code ("9503.00.0090" -> "950300"), or undefined with fewer. */
export const hs6 = (code: string | undefined) => {
  const digits = code?.replace(/\D/g, '') ?? '';
  return digits.length >= 6 ? digits.slice(0, 6) : undefined;
};

/**
 * T8: the certificate of origin covers the invoice goods: every invoice line's HS subheading (six
 * digits) is on the certificate, and the origin the certificate gives agrees with the invoice line's.
 * Lines without an HS code, and certificates without any, are compared on origin only.
 */
export const t8OriginGoods: Rule = {
  definition: {
    id: 'T8',
    title: 'Certificate of origin covers the invoice goods',
    appliesTo: 'ALL',
    requires: ['COMMERCIAL_INVOICE'],
    requiresAny: ['CERTIFICATE_OF_ORIGIN', 'CUSMA_CERTIFICATION'],
    kind: 'DETERMINISTIC',
    severity: 'MEDIUM',
    optional: true,
  },
  run(ctx) {
    if (!ctx.invoice) return [];
    const inv = ctx.invoice;
    const results: RuleResult[] = [];
    const certs = [
      ctx.certificateOfOrigin && {
        id: ctx.certificateOfOrigin.id,
        label: 'certificate of origin',
        /** One origin for the whole certificate. */
        oneOrigin: true,
        goods: ctx.certificateOfOrigin.data.goods.map((g, i) => ({ i, hs: hs6(g.hsCode), origin: ctx.certificateOfOrigin!.data.countryOfOrigin, originField: 'countryOfOrigin' })),
      },
      ctx.cusmaCertification && {
        id: ctx.cusmaCertification.id,
        label: 'CUSMA certification',
        oneOrigin: false,
        goods: ctx.cusmaCertification.data.goods.map((g, i) => ({ i, hs: hs6(g.hsCode), origin: g.countryOfOrigin, originField: `goods[${i}].countryOfOrigin` })),
      },
    ].filter((c): c is NonNullable<typeof c> => !!c);

    const coo = ctx.certificateOfOrigin;
    if (coo && !coo.data.countryOfOrigin) {
      results.push({
        severity: 'HIGH',
        message: 'The certificate of origin does not state the country of origin.',
        evidence: [{ documentId: coo.id, field: 'countryOfOrigin', value: '' }],
        suggestedFix: 'A certificate of origin that does not name the origin certifies nothing; ask for a corrected one.',
      });
    }
    for (const cert of certs) {
      const certHs = new Set(cert.goods.map((g) => g.hs).filter(Boolean));
      if (certHs.size > 0) {
        const uncovered = inv.data.lines.map((l, i) => ({ l, i, hs: hs6(l.hsCode) })).filter((x) => x.hs && !certHs.has(x.hs));
        if (uncovered.length) {
          results.push({
            message: `The ${cert.label} does not list HS ${[...new Set(uncovered.map((u) => u.l.hsCode))].join(', ')} (invoice line ${uncovered.map((u) => u.l.lineNo).join(', ')}); it lists ${[...certHs].join(', ')}.`,
            evidence: [
              ...uncovered.map((u): Evidence => ({ documentId: inv.id, field: `lines[${u.i}].hsCode`, value: u.l.hsCode! })),
              ...cert.goods.filter((g) => g.hs).map((g): Evidence => ({ documentId: cert.id, field: `goods[${g.i}].hsCode`, value: g.hs! })),
            ],
            suggestedFix: 'Ask for a certificate that covers every line, or check whether the HS code on the invoice or the certificate is wrong.',
          });
        }
      }
      // Origin: a certificate origin that no line of the same goods shares.
      const mismatched = inv.data.lines
        .map((l, i) => ({ l, i, cert: cert.goods.find((g) => g.hs && g.hs === hs6(l.hsCode)) ?? (cert.goods.length === 1 || cert.oneOrigin ? cert.goods[0] : undefined) }))
        .filter((x) => x.l.countryOfOrigin && x.cert?.origin && x.cert.origin !== x.l.countryOfOrigin);
      if (mismatched.length) {
        const first = mismatched[0];
        results.push({
          severity: 'HIGH',
          message: `The ${cert.label} gives origin ${first.cert!.origin}, but the invoice says ${[...new Set(mismatched.map((m) => m.l.countryOfOrigin))].join(', ')} for line ${mismatched.map((m) => m.l.lineNo).join(', ')}.`,
          evidence: [
            { documentId: cert.id, field: first.cert!.originField, value: first.cert!.origin! },
            ...mismatched.map((m): Evidence => ({ documentId: inv.id, field: `lines[${m.i}].countryOfOrigin`, value: m.l.countryOfOrigin! })),
          ],
          suggestedFix: 'Origin decides the duty rate and any marking; confirm where the goods were made and correct the document that is wrong.',
        });
      }
    }
    return results;
  },
};
