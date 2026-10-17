import { CUSMA_ELEMENTS, type CusmaElement, type DutyInputs } from '../api/dutyTypes';

export interface MoneyDraft {
  amount: string;
  currency: string;
}

/** The duty questions as the form edits them: strings, empty when unanswered. */
export interface DutyForm {
  entryDate: string;
  province: string;
  relatedParty: '' | 'yes' | 'no';
  assists: MoneyDraft;
  royalties: MoneyDraft;
  freight: MoneyDraft;
  insurance: MoneyDraft;
  inlandFreight: MoneyDraft;
  brokerage: MoneyDraft;
  preference: string;
  certification: Record<CusmaElement, boolean>;
  proofOnFile: boolean;
  /** By invoice line number. */
  tariffNumbers: Record<string, string>;
  metalContent: Record<string, string>;
  /** By currency code: destination currency per 1 unit. */
  exchangeRates: Record<string, string>;
}

const MONEY_KEYS = ['assists', 'royalties', 'freight', 'insurance', 'inlandFreight', 'brokerage'] as const;
const AMOUNT = /^\d+(\.\d+)?$/;
const TARIFF = /^\d{4}\.?\d{2}(\.?\d{2}){0,2}$/;
const CURRENCY = /^[A-Z]{3}$/;

const money = (m: { amount: string; currency: string } | undefined, currency: string): MoneyDraft => ({ amount: m?.amount ?? '', currency: m?.currency ?? currency });

/** Saved answers → form. `currency` is the invoice currency, the default for new amounts. */
export function toForm(inputs: DutyInputs, currency: string): DutyForm {
  const cert = inputs.preference?.certification ?? {};
  return {
    entryDate: inputs.entryDate ?? '',
    province: inputs.province ?? '',
    relatedParty: inputs.relatedParty === undefined ? '' : inputs.relatedParty ? 'yes' : 'no',
    assists: money(inputs.assists, currency),
    royalties: money(inputs.royalties, currency),
    freight: money(inputs.freight, currency),
    insurance: money(inputs.insurance, currency),
    inlandFreight: money(inputs.inlandFreight, currency),
    brokerage: money(inputs.brokerage, currency),
    preference: inputs.preference?.agreement ?? '',
    certification: Object.fromEntries(CUSMA_ELEMENTS.map((e) => [e, cert[e] === true])) as Record<CusmaElement, boolean>,
    proofOnFile: inputs.preference?.proofOnFile === true,
    tariffNumbers: { ...inputs.tariffNumbers },
    metalContent: Object.fromEntries(Object.entries(inputs.metalContent ?? {}).map(([k, v]) => [k, v.amount])),
    exchangeRates: { ...inputs.exchangeRates },
  };
}

/**
 * Form → answers for the API. Empty fields are left out (unanswered, never zero); a value that does
 * not parse is reported in `invalid` by its field name ("freight", "tariffNumbers.2") and left out.
 */
export function toInputs(form: DutyForm, currency: string): { inputs: DutyInputs; invalid: string[] } {
  const invalid: string[] = [];
  const inputs: DutyInputs = {};
  const amount = (raw: string) => raw.trim().replace(/\s/g, '');
  if (form.entryDate) inputs.entryDate = form.entryDate;
  if (form.province) inputs.province = form.province;
  if (form.relatedParty) inputs.relatedParty = form.relatedParty === 'yes';
  for (const key of MONEY_KEYS) {
    const a = amount(form[key].amount);
    if (!a) continue;
    const c = form[key].currency.trim().toUpperCase();
    if (!AMOUNT.test(a) || !CURRENCY.test(c)) invalid.push(key);
    else inputs[key] = { amount: a, currency: c };
  }
  if (form.preference) {
    const certification = Object.fromEntries(CUSMA_ELEMENTS.filter((e) => form.certification[e]).map((e) => [e, true]));
    inputs.preference = { agreement: form.preference, ...(form.preference === 'CUSMA' ? { certification } : { proofOnFile: form.proofOnFile }) };
  }
  const tariffs = Object.entries(form.tariffNumbers).filter(([, v]) => v.trim());
  if (tariffs.length) {
    inputs.tariffNumbers = {};
    for (const [line, v] of tariffs) {
      if (TARIFF.test(v.trim())) inputs.tariffNumbers[line] = v.trim();
      else invalid.push(`tariffNumbers.${line}`);
    }
  }
  const metal = Object.entries(form.metalContent).filter(([, v]) => amount(v));
  if (metal.length) {
    inputs.metalContent = {};
    for (const [line, v] of metal) {
      if (AMOUNT.test(amount(v))) inputs.metalContent[line] = { amount: amount(v), currency };
      else invalid.push(`metalContent.${line}`);
    }
  }
  const rates = Object.entries(form.exchangeRates).filter(([, v]) => amount(v));
  if (rates.length) {
    inputs.exchangeRates = {};
    for (const [cur, v] of rates) {
      if (AMOUNT.test(amount(v)) && /[1-9]/.test(amount(v))) inputs.exchangeRates[cur] = amount(v);
      else invalid.push(`exchangeRates.${cur}`);
    }
  }
  return { inputs, invalid };
}
