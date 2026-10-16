import { useState, type FormEvent } from 'react';
import type { Plan, PlanInput } from '../../api/usage';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { Select } from '../../components/ui/Select';
import { TextInput } from '../../components/ui/TextInput';
import { useI18n } from '../../i18n/useI18n';

export interface PlanEditorProps {
  plan: Plan;
  busy: boolean;
  onSave: (input: PlanInput) => void;
}

const toLimit = (s: string): number | null => (s.trim() === '' ? null : Number(s));

/** The limits of one plan; an empty limit is unlimited. */
export function PlanEditor({ plan, busy, onSave }: PlanEditorProps) {
  const { t } = useI18n();
  const [name, setName] = useState(plan.name);
  const [extractions, setExtractions] = useState(plan.extractionsPerMonth?.toString() ?? '');
  const [validations, setValidations] = useState(plan.validationsPerMonth?.toString() ?? '');
  const [warn, setWarn] = useState(String(plan.warnPercent));
  const [enforcement, setEnforcement] = useState(plan.enforcement);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSave({ name: name.trim(), extractionsPerMonth: toLimit(extractions), validationsPerMonth: toLimit(validations), warnPercent: Number(warn), enforcement });
  };
  const number = { type: 'number', min: 0, step: 1, inputMode: 'numeric' } as const;
  return (
    <Card title={plan.name}>
      <form className="plan-editor" onSubmit={submit} aria-busy={busy}>
        <Field label={t('plans.name')}>{(id) => <TextInput id={id} value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} />}</Field>
        <Field label={t('plans.extractions')}>
          {(id) => <TextInput id={id} {...number} value={extractions} placeholder={t('plans.unlimitedHint')} onChange={(e) => setExtractions(e.target.value)} />}
        </Field>
        <Field label={t('plans.validations')}>
          {(id) => <TextInput id={id} {...number} value={validations} placeholder={t('plans.unlimitedHint')} onChange={(e) => setValidations(e.target.value)} />}
        </Field>
        <Field label={t('plans.warnPercent')}>{(id) => <TextInput id={id} type="number" min={1} max={100} value={warn} onChange={(e) => setWarn(e.target.value)} required />}</Field>
        <Field label={t('plans.enforcement')}>
          {(id) => (
            <Select
              id={id}
              value={enforcement}
              onValueChange={setEnforcement}
              options={[
                { value: 'hard', label: t('plans.hard') },
                { value: 'soft', label: t('plans.soft') },
              ]}
            />
          )}
        </Field>
        <div>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
