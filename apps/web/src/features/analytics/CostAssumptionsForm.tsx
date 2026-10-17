import { useState } from 'react';
import { analyticsApi, type CostAssumptions, type Severity } from '../../api/analytics';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Checkbox } from '../../components/ui/Checkbox';
import { Field } from '../../components/ui/Field';
import { DESTINATIONS } from '../../constants/destinations';
import { TextInput } from '../../components/ui/TextInput';
import { useI18n } from '../../i18n/useI18n';
import { errorMessage } from '../../lib/errorMessage';

const AMOUNT = /^\d{1,9}(\.\d{1,2})?$/;
const SEVERITIES: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

export interface CostAssumptionsFormProps {
  initial: CostAssumptions;
  onSaved: () => void;
  onCancel: () => void;
}

/** Edits the penalty amounts, the rules each applies to, the hold and the transit days; saved per account. */
export function CostAssumptionsForm({ initial, onSaved, onCancel }: CostAssumptionsFormProps) {
  const { t } = useI18n();
  const [a, setA] = useState<CostAssumptions>(() => structuredClone(initial));
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const amounts = [...a.penalties.map((p) => p.amount), ...Object.values(a.delay.perDay).map((r) => r.amount)];
  const valid = amounts.every((x) => AMOUNT.test(x.trim()));

  const setPenalty = (i: number, patch: Partial<CostAssumptions['penalties'][number]>) => setA((s) => ({ ...s, penalties: s.penalties.map((p, k) => (k === i ? { ...p, ...patch } : p)) }));
  const save = async () => {
    if (!valid) return setError(t('analytics.cost.assumptions.invalid'));
    setSaving(true);
    setError(undefined);
    try {
      await analyticsApi.saveCost({
        ...a,
        penalties: a.penalties.map((p) => ({ ...p, amount: p.amount.trim(), currency: p.currency.trim().toUpperCase(), ruleIds: p.ruleIds.map((r) => r.trim().toUpperCase()).filter(Boolean) })),
      });
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="cost-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {error && <Banner tone="error">{error}</Banner>}
      <fieldset className="fieldset">
        <legend className="section-title">{t('analytics.cost.assumptions.penalties')}</legend>
        {a.penalties.map((p, i) => (
          <div key={p.id} className="cost-penalty">
            <p className="cost-penalty-label">
              <strong>{p.destination}</strong> · {p.label}
            </p>
            <div className="setting-row">
              <Field label={t('analytics.cost.assumptions.amount')}>
                {(id) => <TextInput id={id} inputMode="decimal" value={p.amount} onChange={(e) => setPenalty(i, { amount: e.target.value })} aria-invalid={!AMOUNT.test(p.amount.trim())} size={10} />}
              </Field>
              <Field label={t('analytics.cost.assumptions.currency')}>
                {(id) => <TextInput id={id} value={p.currency} maxLength={3} onChange={(e) => setPenalty(i, { currency: e.target.value })} size={4} />}
              </Field>
              <Field label={t('analytics.cost.assumptions.rules')} grow>
                {(id) => <TextInput id={id} value={p.ruleIds.join(', ')} onChange={(e) => setPenalty(i, { ruleIds: e.target.value.split(',') })} />}
              </Field>
            </div>
          </div>
        ))}
      </fieldset>
      <fieldset className="fieldset">
        <legend className="section-title">{t('analytics.cost.assumptions.delay')}</legend>
        <div className="setting-row">
          <Field label={t('analytics.cost.assumptions.delayDays')}>
            {(id) => <TextInput id={id} type="number" min={0} max={60} value={a.delay.days} onChange={(e) => setA((s) => ({ ...s, delay: { ...s.delay, days: Math.max(0, Math.min(60, Number(e.target.value) || 0)) } }))} />}
          </Field>
          {DESTINATIONS.map((d) => {
            const rate = a.delay.perDay[d];
            if (!rate) return null;
            return (
              <Field key={d} label={t('analytics.cost.assumptions.perDay', { destination: d })}>
                {(id) => (
                  <span className="cost-money-input">
                    <TextInput
                      id={id}
                      inputMode="decimal"
                      size={10}
                      value={rate.amount}
                      aria-invalid={!AMOUNT.test(rate.amount.trim())}
                      onChange={(e) => setA((s) => ({ ...s, delay: { ...s.delay, perDay: { ...s.delay.perDay, [d]: { ...rate, amount: e.target.value } } } }))}
                    />
                    <span className="muted">{rate.currency}</span>
                  </span>
                )}
              </Field>
            );
          })}
        </div>
        <p className="field-label">{t('analytics.cost.assumptions.delaySeverities')}</p>
        <div className="checkbox-row">
          {SEVERITIES.map((sev) => (
            <Checkbox
              key={sev}
              label={t(`severity.${sev}`)}
              checked={a.delay.severities.includes(sev)}
              onCheckedChange={(on) => setA((s) => ({ ...s, delay: { ...s.delay, severities: on ? [...s.delay.severities, sev] : s.delay.severities.filter((x) => x !== sev) } }))}
            />
          ))}
        </div>
      </fieldset>
      <fieldset className="fieldset">
        <legend className="section-title">{t('analytics.cost.assumptions.transit')}</legend>
        <div className="setting-row">
          {(['SEA', 'AIR', 'ROAD'] as const).map((m) => (
            <Field key={m} label={t(`transportModes.${m}`)}>
              {(id) => <TextInput id={id} type="number" min={0} max={120} value={a.transitDays[m]} onChange={(e) => setA((s) => ({ ...s, transitDays: { ...s.transitDays, [m]: Math.max(0, Number(e.target.value) || 0) } }))} />}
            </Field>
          ))}
        </div>
      </fieldset>
      <div className="setting-row">
        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? t('common.saving') : t('analytics.cost.assumptions.save')}
        </Button>
        <Button onClick={onCancel}>{t('analytics.cost.assumptions.cancel')}</Button>
      </div>
    </form>
  );
}
