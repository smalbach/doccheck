import { describe, expect, it } from 'vitest';
import { toForm, toInputs } from './dutyForm';

describe('duty answers form', () => {
  it('leaves unanswered fields out instead of sending zeros', () => {
    expect(toInputs(toForm({}, 'USD'), 'USD')).toEqual({ inputs: {}, invalid: [] });
  });

  it('round-trips saved answers', () => {
    const saved = {
      entryDate: '2026-10-16',
      province: 'ON',
      relatedParty: false,
      assists: { amount: '0', currency: 'USD' },
      freight: { amount: '850.00', currency: 'EUR' },
      preference: { agreement: 'CUSMA', certification: { certifier: true, exporter: true } },
      tariffNumbers: { '1': '8482.10.50.08' },
      metalContent: { '2': { amount: '600', currency: 'USD' } },
      exchangeRates: { CNY: '0.1923' },
    };
    expect(toInputs(toForm(saved, 'USD'), 'USD')).toEqual({ inputs: saved, invalid: [] });
  });

  it('reports values that do not parse by field', () => {
    const form = toForm({}, 'USD');
    form.freight.amount = '1,250.00';
    form.tariffNumbers['3'] = '84-82';
    form.exchangeRates.EUR = '0';
    form.preference = 'CETA';
    form.proofOnFile = true;
    const { inputs, invalid } = toInputs(form, 'USD');
    expect(invalid).toEqual(['freight', 'tariffNumbers.3', 'exchangeRates.EUR']);
    expect(inputs).toEqual({ preference: { agreement: 'CETA', proofOnFile: true }, tariffNumbers: {}, exchangeRates: {} });
  });
});
