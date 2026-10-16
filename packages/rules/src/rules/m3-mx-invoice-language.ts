import { DEFAULT_PARAMS, type Rule } from '../types';
import { c2InvoiceLanguage } from './c2-invoice-language';

/** M3: the invoice is in Spanish, English or French; any other language needs a Spanish translation (RGCE regla 3.1.8). */
export const m3MxInvoiceLanguage: Rule = {
  definition: {
    id: 'M3',
    title: 'Invoice is in Spanish, English or French, or translated',
    appliesTo: ['MX'],
    requires: ['COMMERCIAL_INVOICE'],
    kind: 'COMPLETENESS',
    severity: 'MEDIUM',
  },
  run: (ctx) =>
    c2InvoiceLanguage.run(ctx, DEFAULT_PARAMS).map((r) => ({
      ...r,
      message: `${r.message.replace(/\.$/, '')}; in any other language the description and values must be translated into Spanish (RGCE regla 3.1.8).`,
      suggestedFix: 'Request a Spanish translation of the invoice, on the invoice itself or attached to it.',
    })),
};
