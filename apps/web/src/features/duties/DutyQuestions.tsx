import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CUSMA_ELEMENTS, type DutyEstimate, type DutyInputs } from '../../api/dutyTypes';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Checkbox } from '../../components/ui/Checkbox';
import { Field } from '../../components/ui/Field';
import { Select } from '../../components/ui/Select';
import { TextInput } from '../../components/ui/TextInput';
import { useI18n } from '../../i18n/useI18n';
import { type DutyForm, type MoneyDraft, toForm, toInputs } from '../../lib/dutyForm';

const PROVINCES = ['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'] as const;
const AGREEMENTS = { CA: ['CUSMA', 'CPTPP', 'CETA', 'CUKTCA', 'CCOFTA', 'CKFTA', 'CCFTA', 'CPFTA', 'CIFTA', 'CUAFTA'], US: ['CUSMA', 'US-CO-TPA', 'KORUS', 'US-AU', 'US-SG', 'US-CL', 'US-IL', 'US-PE', 'CAFTA-DR'] } as const;
type MoneyKey = 'assists' | 'royalties' | 'freight' | 'insurance' | 'inlandFreight' | 'brokerage';

export interface DutyQuestionsProps {
  estimate: DutyEstimate;
  savedAt?: string;
  busy: boolean;
  demo: boolean;
  /** A question to focus (the `asks` of a finding). */
  focus?: string;
  onFocused: () => void;
  onSubmit: (inputs: DutyInputs) => Promise<boolean>;
}

/** The answers the documents cannot give: related party, assists, freight, the preference claimed, full tariff numbers. */
export function DutyQuestions({ estimate, savedAt, busy, demo, focus, onFocused, onSubmit }: DutyQuestionsProps) {
  const { t, formatDateTime } = useI18n();
  const currency = estimate.invoice?.currency ?? estimate.currency;
  const [form, setForm] = useState<DutyForm>(() => toForm(estimate.inputs, currency));
  const [invalid, setInvalid] = useState<string[]>([]);
  const root = useRef<HTMLFormElement>(null);
  const isCA = estimate.destination === 'CA';
  const qid = (name: string) => `duty-q-${name}`;

  useEffect(() => {
    if (!focus) return;
    const box = root.current?.querySelector<HTMLElement>(`[data-question="${focus}"]`);
    // The question's own control when it has one (a select's trigger, the first input), else its group.
    const target = box?.matches('input, button') ? box : (box?.querySelector<HTMLElement>('input, button') ?? box);
    target?.scrollIntoView({ block: 'center' });
    target?.focus();
    onFocused();
  }, [focus, onFocused]);

  const set = <K extends keyof DutyForm>(key: K, value: DutyForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const { inputs, invalid: bad } = toInputs(form, currency);
    setInvalid(bad);
    if (bad.length) return;
    await onSubmit(inputs);
  };
  const bad = (name: string) => invalid.includes(name) || undefined;

  const moneyField = (key: MoneyKey, label: string, show = true) =>
    show && (
      <MoneyField key={key} id={qid(key)} question={key} label={label} value={form[key]} invalid={bad(key)} onChange={(v) => set(key, v)} currencyLabel={t('duties.questions.currency')} amountLabel={t('duties.questions.amount')} />
    );

  const otherCurrencies = [...new Set(estimate.exchange.map((r) => r.from).filter((c) => c !== estimate.currency))];
  const sellerCarriage = ['CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'].includes(estimate.invoice?.incoterm ?? '');

  return (
    <form ref={root} className="duty-section duty-questions no-print" aria-labelledby="duty-questions" onSubmit={(e) => void submit(e)} noValidate>
      <h3 id="duty-questions">{t('duties.questions.title')}</h3>
      <p className="small muted">{demo ? t('duties.questions.demo') : t('duties.questions.intro')}</p>
      {invalid.length > 0 && <Banner tone="error">{t('duties.questions.invalid')}</Banner>}
      <div className="duty-grid">
        <Field label={t('duties.questions.relatedParty')}>
          {(id) => (
            <span data-question="relatedParty">
              <Select
                id={id}
                value={form.relatedParty || 'unanswered'}
                onValueChange={(v) => set('relatedParty', v === 'unanswered' ? '' : v)}
                options={[
                  { value: 'unanswered', label: t('duties.questions.unanswered') },
                  { value: 'no', label: t('duties.questions.no') },
                  { value: 'yes', label: t('duties.questions.yes') },
                ]}
              />
            </span>
          )}
        </Field>
        <Field label={t('duties.questions.entryDate')}>{(id) => <TextInput id={id} type="date" value={form.entryDate} onChange={(e) => set('entryDate', e.target.value)} />}</Field>
        {isCA && (
          <Field label={t('duties.questions.province')}>
            {(id) => (
              <span data-question="province">
                <Select
                  id={id}
                  value={form.province || 'docs'}
                  onValueChange={(v) => set('province', v === 'docs' ? '' : v)}
                  options={[{ value: 'docs', label: estimate.province && !form.province ? `${t('duties.questions.fromDocuments')} (${estimate.province.code})` : t('duties.questions.fromDocuments') }, ...PROVINCES.map((p) => ({ value: p, label: p }))]}
                />
              </span>
            )}
          </Field>
        )}
      </div>
      <div className="duty-grid">
        {moneyField('assists', t('duties.questions.assists'))}
        {moneyField('royalties', t('duties.questions.royalties'))}
        {moneyField('freight', t('duties.questions.freight'))}
        {moneyField('insurance', t('duties.questions.insurance'), sellerCarriage || form.insurance.amount !== '')}
        {moneyField('inlandFreight', t('duties.questions.inlandFreight'), isCA)}
        {moneyField('brokerage', t('duties.questions.brokerage'))}
      </div>

      <fieldset className="duty-fieldset" data-question="preference" tabIndex={-1}>
        <legend>{t('duties.questions.preference')}</legend>
        <Field label={t('duties.questions.preference')}>
          {(id) => (
            <Select
              id={id}
              value={form.preference || 'none'}
              onValueChange={(v) => set('preference', v === 'none' ? '' : v)}
              options={[{ value: 'none', label: t('duties.questions.noPreference') }, ...((AGREEMENTS as Record<string, readonly string[]>)[estimate.destination] ?? []).map((a) => ({ value: a, label: a }))]}
            />
          )}
        </Field>
        {form.preference === 'CUSMA' && (
          <div className="duty-checks">
            <p className="small">{t('duties.questions.certification')}</p>
            {CUSMA_ELEMENTS.map((el) => (
              <Checkbox key={el} label={t(`duties.questions.elements.${el}`)} checked={form.certification[el]} onCheckedChange={(c) => set('certification', { ...form.certification, [el]: c })} />
            ))}
          </div>
        )}
        {form.preference && form.preference !== 'CUSMA' && <Checkbox label={t('duties.questions.proofOnFile')} checked={form.proofOnFile} onCheckedChange={(c) => set('proofOnFile', c)} />}
      </fieldset>

      <fieldset className="duty-fieldset" data-question="tariffNumbers" tabIndex={-1}>
        <legend>{t('duties.questions.tariffNumbers')}</legend>
        <div className="duty-grid">
          {estimate.lines.map((l) => (
            <Field key={l.lineNo} label={`${t('duties.questions.lineLabel', { line: l.lineNo })}: ${l.description}`}>
              {(id) => (
                <TextInput
                  id={id}
                  inputMode="decimal"
                  placeholder={l.tariff?.classification ?? l.hsInput ?? ''}
                  value={form.tariffNumbers[String(l.lineNo)] ?? ''}
                  aria-invalid={bad(`tariffNumbers.${l.lineNo}`)}
                  onChange={(e) => set('tariffNumbers', { ...form.tariffNumbers, [String(l.lineNo)]: e.target.value })}
                />
              )}
            </Field>
          ))}
        </div>
      </fieldset>

      {(estimate.lines.some((l) => l.additional.some((a) => a.id.startsWith('232'))) || Object.keys(form.metalContent).length > 0) && (
        <fieldset className="duty-fieldset" data-question="metalContent" tabIndex={-1}>
          <legend>{t('duties.questions.metalContent')}</legend>
          <div className="duty-grid">
            {estimate.lines
              .filter((l) => l.additional.some((a) => a.id.startsWith('232')) || form.metalContent[String(l.lineNo)])
              .map((l) => (
                <Field key={l.lineNo} label={`${t('duties.questions.lineLabel', { line: l.lineNo })} (${currency})`}>
                  {(id) => (
                    <TextInput id={id} inputMode="decimal" value={form.metalContent[String(l.lineNo)] ?? ''} aria-invalid={bad(`metalContent.${l.lineNo}`)} onChange={(e) => set('metalContent', { ...form.metalContent, [String(l.lineNo)]: e.target.value })} />
                  )}
                </Field>
              ))}
          </div>
        </fieldset>
      )}

      {otherCurrencies.length > 0 && (
        <div className="duty-grid" data-question="exchangeRates" tabIndex={-1}>
          {otherCurrencies.map((c) => (
            <Field key={c} label={t('duties.questions.exchangeRate', { to: estimate.currency, from: c })}>
              {(id) => (
                <TextInput
                  id={id}
                  inputMode="decimal"
                  placeholder={estimate.exchange.find((r) => r.from === c)?.rate}
                  value={form.exchangeRates[c] ?? ''}
                  aria-invalid={bad(`exchangeRates.${c}`)}
                  onChange={(e) => set('exchangeRates', { ...form.exchangeRates, [c]: e.target.value })}
                />
              )}
            </Field>
          ))}
        </div>
      )}

      <div className="duty-actions">
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? t('duties.questions.saving') : t('duties.questions.save')}
        </Button>
        {savedAt && !demo && <span className="small muted">{t('duties.questions.saved', { date: formatDateTime(savedAt) })}</span>}
      </div>
    </form>
  );
}

interface MoneyFieldProps {
  id: string;
  question: string;
  label: string;
  value: MoneyDraft;
  invalid?: boolean;
  amountLabel: string;
  currencyLabel: string;
  onChange: (value: MoneyDraft) => void;
}

/** An amount and its currency, under one label. */
function MoneyField({ id, question, label, value, invalid, amountLabel, currencyLabel, onChange }: MoneyFieldProps) {
  return (
    <fieldset className="duty-money">
      <legend>{label}</legend>
      <TextInput id={id} data-question={question} inputMode="decimal" aria-label={`${label}: ${amountLabel}`} aria-invalid={invalid} value={value.amount} onChange={(e) => onChange({ ...value, amount: e.target.value })} />
      <TextInput className="duty-currency" aria-label={`${label}: ${currencyLabel}`} maxLength={3} value={value.currency} onChange={(e) => onChange({ ...value, currency: e.target.value.toUpperCase() })} />
    </fieldset>
  );
}
