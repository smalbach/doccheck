import type { Destination } from '@doccheck/schemas';

/**
 * A country profile = which rules run + which regulation corpus the agent searches.
 * X* rules compare documents and run everywhere they apply; C* are CBSA-specific, U* CBP-specific.
 */
export interface CountryProfile {
  code: Destination;
  authority: 'CBSA' | 'CBP';
  allowedInvoiceLanguages: string[];
  rules: string[];
  corpusTag: string;
}

/** Rules on the other freight documents (T*); each one only runs when the shipment has its documents. */
const DOCUMENT_RULES = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12', 'T13'];

const SHARED = ['X1', 'X2', 'X3', 'X4', 'X5', 'X6', 'X7', 'X8', 'X9', 'X10', 'X12', ...DOCUMENT_RULES];

export const PROFILES: Record<Destination, CountryProfile> = {
  // CBSA Memorandum D1-4-1: invoice in English or French.
  CA: { code: 'CA', authority: 'CBSA', allowedInvoiceLanguages: ['en', 'fr'], rules: [...SHARED, 'C1', 'C2'], corpusTag: 'cbsa' },
  // 19 CFR 141.86(d): invoice in English or with an English translation.
  US: { code: 'US', authority: 'CBP', allowedInvoiceLanguages: ['en'], rules: [...SHARED, 'X11', 'U1'], corpusTag: 'cbp' },
};
