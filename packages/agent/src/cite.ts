import { excerpt, sentenceMatch, type RegulationIndex } from '@doccheck/regulations';
import { PROFILES, type Authority } from '@doccheck/rules';
import type { Destination, Finding } from '@doccheck/schemas';

/**
 * What to look up for each rule. Completeness findings search with their own message, which names
 * the missing field and its CI1 field or 141.86 paragraph. `null` means the corpus has nothing on
 * it (ISO 6346 is an industry standard, not a customs regulation), so no citation is attached.
 */
const QUERIES: Record<string, Partial<Record<Authority, string | null>>> = {
  X1: { CBSA: 'consignee name and address shipped to', CBP: 'person to whom the merchandise is sold or shipped' },
  X2: { CBSA: 'number of packages', CBP: 'marks and numbers of the packages' },
  X3: { CBSA: 'net and gross weight', CBP: 'quantities in weights and measures' },
  X4: { CBSA: 'net and gross weight', CBP: 'quantities in weights and measures' },
  X5: { CBSA: 'unit price total price paid or payable', CBP: 'purchase price of each item' },
  X6: { CBSA: 'currency of settlement', CBP: 'purchase price in the currency of the purchase' },
  X7: { CBSA: 'quantity of goods description', CBP: 'quantities in weights and measures' },
  X8: { CBSA: 'other references commercial invoice number', CBP: null },
  X9: { CBSA: 'Field 2: Date of direct shipment to Canada', CBP: 'the time when the merchandise is shipped' },
  X10: { CBSA: null, CBP: null },
  X12: { CBSA: 'Field 9: Conditions of sale and terms of payment terms and conditions agreed upon by the vendor and the purchaser', CBP: 'all charges upon the merchandise itemized by name and amount including freight' },
  X11: { CBSA: null, CBP: 'importer security filing data elements' },
  C2: { CBSA: 'invoice in English or French translation', CBP: null },
  A1: { CBSA: 'detailed description of the goods', CBP: 'detailed description of the merchandise', ANAM: 'descripción comercial detallada de las mercancías', UCC: 'description of goods', HMRC: 'description of the goods' },
  M2: { ANAM: 'Datos del destinatario la clave en el RFC' },
  M3: { ANAM: 'idiomas distintos del español, inglés o francés, deberán traducirse al idioma español' },
  E2: { UCC: 'EORI number identification number unique in the customs territory of the Union' },
  K2: { HMRC: "A GB EORI has 12 digits and the prefix 'GB'" },
  K3: { HMRC: 'statement on origin exporter reference number REX preferential origin' },
  // Rules added after v1. X22 is about the same invoice charges as X12, so it cites the same passages.
  X22: { CBSA: 'Field 9: Conditions of sale and terms of payment terms and conditions agreed upon by the vendor and the purchaser', CBP: 'all charges upon the merchandise itemized by name and amount including freight' },
  U2: { CBSA: null, CBP: 'importer security filing data elements' },
  U3: { CBSA: null, CBP: 'no later than 24 hours before the cargo is laden aboard the vessel at the foreign port' },
};

/** Completeness rules: their findings end with "(<authority> <ref>)", which the citation query keeps. */
const COMPLETENESS = new Set(['C1', 'U1', 'M1', 'E1', 'K1']);

export function citationQuery(finding: Finding, destination: Destination): string | null {
  const authority = PROFILES[destination].authority;
  if (COMPLETENESS.has(finding.ruleId)) {
    // "Country of origin is missing on every invoice line (CBSA CI1 field 7)." -> "Country of origin field 7"
    const label = finding.message.split(' is missing')[0];
    const ref = finding.message.match(/\(([^)]*)\)\.?$/)?.[1].replace(/^(CBSA|19 CFR|RGCE|UCC|HMRC) /, '') ?? '';
    return `${label} ${ref}`.trim();
  }
  if (finding.ruleId === 'X11') {
    // Cite the ISF data element that disagrees, not the filing requirement in general.
    const field = finding.evidence[0]?.field ?? '';
    // Wording of the 19 CFR 149.3(a) data elements, so both retrievers land on the right paragraph.
    const element: Record<string, string> = {
      countryOfOrigin: 'Country of origin. Country of manufacture, production, or growth of the article',
      htsCode: 'Commodity HTSUS number. Duty/statistical reporting number Harmonized Tariff Schedule',
      'seller.name': 'Seller. Name and address of the last known entity by whom the goods are sold or agreed to be sold',
      'buyer.name': 'Buyer. Name and address of the last known entity to whom the goods are sold or agreed to be sold',
    };
    return element[field] ?? 'importer security filing data elements';
  }
  if (finding.ruleId === 'E3') {
    // "HS code to six digits is missing ... (UCC Annex B D.E. 18 09 056 000)." -> the ENS data element.
    return finding.message.match(/\(UCC (Annex B D\.E\. [\d ]+)\)\.?$/)?.[1] ?? 'entry summary declaration particulars';
  }
  return QUERIES[finding.ruleId]?.[authority] ?? null;
}

/**
 * Documents each finding may cite. The invoice rules are about what the invoice must show, which is
 * defined by D1-4-1 (CI1 fields), 19 CFR 141.86, RGCE reglas 3.1.8 and 1.9.19, Annex B of Delegated
 * Regulation 2015/2446 and HMRC's CDS completion guide; X11 compares the ISF, defined by 19 CFR 149.3.
 * The rest of the corpus (marking, proof of origin, valuation) is searchable but would otherwise
 * outrank the field definition for words like "country of origin" or "price paid or payable".
 */
export const INVOICE_REQUIREMENTS: Record<Authority, readonly string[]> = {
  CBSA: ['cbsa-d1-4-1'],
  CBP: ['cfr-19-141-86'],
  ANAM: ['mx-rgce'],
  UCC: ['eu-2015-2446'],
  HMRC: ['hmrc-cds'],
};

/** Rules whose basis is a document of its own rather than the invoice requirements. */
const RULE_SCOPE: Record<string, string[]> = {
  X11: ['cfr-19-149'],
  U2: ['cfr-19-149'],
  U3: ['cfr-19-149'],
  E2: ['eu-2015-2446', 'eu-ucc'],
  E3: ['eu-2015-2446'],
  K2: ['hmrc-eori'],
  K3: ['hmrc-tca-origin', 'tca-annex-7'],
};

export function citationScope(finding: Finding, destination: Destination): string[] {
  if (RULE_SCOPE[finding.ruleId]) return RULE_SCOPE[finding.ruleId];
  return [...INVOICE_REQUIREMENTS[PROFILES[destination].authority]];
}

/** Called (and awaited) each time a finding gets its passage; errors it throws are ignored. */
export type OnCited = (finding: Finding & { regulation: NonNullable<Finding['regulation']> }) => void | Promise<void>;

/**
 * Attaches the best matching passage of the destination's regulations to each finding.
 * A passage is only used when both retrievers agree it is relevant (it ranks in the keyword top 5),
 * so an unrelated paragraph is never presented as the legal basis.
 */
export async function attachRegulations(findings: Finding[], destination: Destination, index: RegulationIndex, onCited?: OnCited): Promise<Finding[]> {
  const authority = PROFILES[destination].authority;
  const cache = new Map<string, Finding['regulation'] | null>();
  for (const finding of findings) {
    if (finding.regulation) continue;
    const query = citationQuery(finding, destination);
    if (!query) continue;
    const documents = citationScope(finding, destination);
    const key = `${documents.join(',')}|${query}`;
    if (!cache.has(key)) {
      // Among relevant passages, quote the one with the sentence closest to the query: a short chunk can
      // outrank the paragraph that actually defines the field.
      const relevant = (await index.search(query, { authority, documents, language: 'en', limit: 3 })).filter((h) => (h.ranks.keyword ?? 99) <= 5);
      const hit = relevant.reduce<(typeof relevant)[number] | undefined>(
        (best, h) => (!best || sentenceMatch(h.chunk.text, query) > sentenceMatch(best.chunk.text, query) ? h : best),
        undefined,
      );
      cache.set(
        key,
        hit
          ? {
              title: hit.chunk.section ? `${hit.chunk.title} — ${hit.chunk.section.split(' > ').pop()}` : hit.chunk.title,
              url: hit.chunk.url,
              effectiveDate: hit.chunk.effectiveDate,
              excerpt: excerpt(hit.chunk.text, query, 500),
            }
          : null,
      );
    }
    const regulation = cache.get(key);
    if (!regulation) continue;
    finding.regulation = regulation;
    try {
      await onCited?.({ ...finding, regulation });
    } catch {
      // Progress must not break the run.
    }
  }
  return findings;
}

/**
 * The rules whose findings may cite a corpus document (`cbsa-d1-4-1-en`, `cfr-19-149`...), per
 * destination: the reverse of citationScope, for telling which rules a changed passage concerns.
 * A rule with no query for the authority (ISO 6346 container numbers) cites nothing.
 */
export function rulesCiting(documentId: string): { destination: Destination; ruleId: string }[] {
  const out: { destination: Destination; ruleId: string }[] = [];
  for (const destination of Object.keys(PROFILES) as Destination[]) {
    const profile = PROFILES[destination];
    for (const ruleId of profile.rules) {
      // The rules citationQuery finds something to search for (the others never get a passage).
      const queried = COMPLETENESS.has(ruleId) || ruleId === 'X11' || ruleId === 'E3' || !!QUERIES[ruleId]?.[profile.authority];
      if (!queried) continue;
      const scope = RULE_SCOPE[ruleId] ?? INVOICE_REQUIREMENTS[profile.authority];
      if (scope.some((d) => documentId === d || documentId.startsWith(`${d}-`))) out.push({ destination, ruleId });
    }
  }
  return out;
}
