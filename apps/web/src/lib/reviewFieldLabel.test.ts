import { describe, expect, it } from 'vitest';
import { en } from '../i18n/messages/en';
import { translate } from '../i18n/translate';
import type { MessageKey, MessageVars } from '../i18n/keys';
import { reviewFieldLabel } from './reviewFieldLabel';

const t = (key: MessageKey, vars?: MessageVars) => translate(en, 'en', key, vars);

describe('reviewFieldLabel', () => {
  it('names header fields, item fields and unknown ones', () => {
    expect(reviewFieldLabel('/netWeight/kg', 'COMMERCIAL_INVOICE', t)).toBe(t('extracted.fields.netWeight'));
    expect(reviewFieldLabel('/lines/2/quantity/value', 'COMMERCIAL_INVOICE', t)).toBe('Line 3 · quantity');
    expect(reviewFieldLabel('/containers/0/seal', 'BILL_OF_LADING', t)).toBe('Container 1 · seal');
    expect(reviewFieldLabel('/lines/0/marks', 'COMMERCIAL_INVOICE', t)).toBe('Line 1 · marks');
    expect(reviewFieldLabel('/voyage', 'ISF', t)).toBe('voyage');
  });
});
