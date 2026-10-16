import type { Destination } from '@doccheck/schemas';

/** Customs authority (or, for the EU, the customs law) whose regulations a destination's findings cite. */
export type Authority = 'CBSA' | 'CBP' | 'ANAM' | 'UCC' | 'HMRC';

/**
 * A country profile = which rules run + which regulation corpus the agent searches.
 * X* rules compare documents and run everywhere they apply; C* are CBSA-specific, U* CBP-specific,
 * M* Mexico (ANAM, RGCE), E* European Union (Union Customs Code), K* United Kingdom (HMRC).
 */
export interface CountryProfile {
  code: Destination;
  authority: Authority;
  allowedInvoiceLanguages: string[];
  rules: string[];
  corpusTag: string;
}

/** Rules on the other freight documents (T*); each one only runs when the shipment has its documents. */
export const DOCUMENT_RULE_IDS: readonly string[] = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12', 'T13'];

const SHARED = ['X1', 'X2', 'X3', 'X4', 'X5', 'X6', 'X7', 'X8', 'X9', 'X10', 'X12', 'X13', 'X14', 'X15', 'X16', 'X17', 'X18', 'X19', 'X20', 'X21', 'X22', 'X23', 'X24', ...DOCUMENT_RULE_IDS];

export const PROFILES: Record<Destination, CountryProfile> = {
  // CBSA Memorandum D1-4-1: invoice in English or French.
  CA: { code: 'CA', authority: 'CBSA', allowedInvoiceLanguages: ['en', 'fr'], rules: [...SHARED, 'C1', 'C2', 'C3'], corpusTag: 'cbsa' },
  // 19 CFR 141.86(d): invoice in English or with an English translation.
  US: { code: 'US', authority: 'CBP', allowedInvoiceLanguages: ['en'], rules: [...SHARED, 'X11', 'U1', 'U2', 'U3', 'U4'], corpusTag: 'cbp' },
  // RGCE regla 3.1.8: Spanish, English or French; any other language with a Spanish translation.
  MX: { code: 'MX', authority: 'ANAM', allowedInvoiceLanguages: ['es', 'en', 'fr'], rules: [...SHARED, 'M1', 'M2', 'M3'], corpusTag: 'anam' },
  // The UCC sets no invoice language; customs may ask for a translation (UCC Article 163(1)).
  EU: { code: 'EU', authority: 'UCC', allowedInvoiceLanguages: [], rules: [...SHARED, 'E1', 'E2', 'E3'], corpusTag: 'ucc' },
  GB: { code: 'GB', authority: 'HMRC', allowedInvoiceLanguages: [], rules: [...SHARED, 'K1', 'K2', 'K3'], corpusTag: 'hmrc' },
};
