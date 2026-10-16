import { toFixed } from '../decimal';
import { EU_EORI_PREFIXES } from '../ids/eori';
import type { Rule, RuleResult } from '../types';

/** EU member states by ISO 3166 code (the EORI prefixes, which use GR for Greece like ISO does). */
export const EU_MEMBER_STATES: readonly string[] = EU_EORI_PREFIXES;

/** "...declares that ... these products are of [EU] preferential origin", in the languages the TCA text is common in. */
const PREFERENTIAL = /preferential origin|origine préférentielle|origen preferencial|präferenzbegünstigt|origine preferenziale|preferencyjne/i;
/** Registered Exporter (REX) number: member state code, "REX", national part. */
const REX = /\b[A-Z]{2}REX[A-Z0-9]{3,}\b/;
/** Above EUR 6 000 an EU exporter is identified by its REX number (HMRC guidance on the TCA statement on origin). */
const REX_THRESHOLD_EUR = '6000';

/**
 * K3 (GB): goods of EU origin get the zero TCA tariff only with a statement on origin made out by the
 * exporter on the invoice (TCA Article 56, text in Annex 7), or on the importer's knowledge. Checks the statement when
 * there is one, and points out its absence. LOW when absent: the goods can still enter at the full rate,
 * and statements are not read from PDFs yet, so this may also mean the statement was not extracted.
 */
export const k3TcaOriginStatement: Rule = {
  definition: {
    id: 'K3',
    title: 'Statement on origin supports the UK-EU TCA preference',
    appliesTo: ['GB'],
    requires: ['COMMERCIAL_INVOICE'],
    kind: 'DETERMINISTIC',
    severity: 'MEDIUM',
  },
  run(ctx) {
    if (!ctx.invoice) return [];
    const { id, data: inv } = ctx.invoice;
    const eu = inv.lines.map((l, i) => ({ l, i })).filter(({ l }) => !!l.countryOfOrigin && EU_MEMBER_STATES.includes(l.countryOfOrigin));
    if (eu.length === 0) return [];
    const lines = eu.length === inv.lines.length ? 'every invoice line' : `line(s) ${eu.map(({ l }) => l.lineNo).join(', ')}`;
    const statement = inv.originStatement?.trim();
    if (!statement) {
      return [
        {
          severity: 'LOW',
          message: `The goods on ${lines} are of EU origin, but no statement on origin was found on the invoice; without one (or the importer's knowledge) the TCA zero tariff cannot be claimed (TCA Article 56 and Annex 7).`,
          evidence: [{ documentId: id, field: 'originStatement', value: '' }, ...eu.map(({ l, i }) => ({ documentId: id, field: `lines[${i}].countryOfOrigin`, value: l.countryOfOrigin! }))],
          suggestedFix: 'If preference will be claimed, ask the exporter to add the statement on origin of TCA Annex 7 to the invoice.',
        },
      ];
    }
    const results: RuleResult[] = [];
    if (!PREFERENTIAL.test(statement)) {
      results.push({
        message: 'The statement on origin does not declare the products to be of preferential origin, as the text of TCA Annex 7 requires.',
        evidence: [{ documentId: id, field: 'originStatement', value: statement }],
        suggestedFix: 'Ask the exporter to use the wording of TCA Annex 7: "...declares that ... these products are of EU preferential origin."',
      });
    }
    if (inv.currency === 'EUR' && toFixed(inv.invoiceTotal.amount) > toFixed(REX_THRESHOLD_EUR) && !REX.test(statement.toUpperCase())) {
      results.push({
        message: `The invoice totals ${inv.invoiceTotal.amount} EUR, above EUR 6 000, but the statement on origin quotes no REX number for the EU exporter, which consignments over EUR 6 000 need (TCA Annex 7, note 2; HMRC TCA origin guidance).`,
        evidence: [
          { documentId: id, field: 'originStatement', value: statement },
          { documentId: id, field: 'invoiceTotal.amount', value: inv.invoiceTotal.amount },
        ],
        suggestedFix: "Ask the exporter for a statement that quotes its REX number.",
      });
    }
    return results;
  },
};
