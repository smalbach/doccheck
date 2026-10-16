import { useState } from 'react';
import type { SettingKey, SettingValues, SettingView } from '../../../api/types';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Field } from '../../../components/ui/Field';
import { Switch } from '../../../components/ui/Switch';
import { TextInput } from '../../../components/ui/TextInput';
import { useI18n } from '../../../i18n/useI18n';
import { SettingSource } from './SettingSource';

export interface LearningSettingsCardProps {
  learning: SettingView<'supplierLearning'>;
  examples: SettingView<'supplierExamples'>;
  threshold: SettingView<'reviewThreshold'>;
  secondPass: SettingView<'reviewSecondPass'>;
  editable: boolean;
  busy: boolean;
  onSave: (values: Partial<SettingValues>) => void;
  onReset: (key: SettingKey) => void;
}

/** Supplier learning (the feature flag and how many examples) and the review queue's threshold. */
export function LearningSettingsCard({ learning, examples, threshold, secondPass, editable, busy, onSave, onReset }: LearningSettingsCardProps) {
  const { t } = useI18n();
  const [count, setCount] = useState(String(examples.value));
  const [percent, setPercent] = useState(String(Math.round(threshold.value * 100)));
  const disabled = !editable || busy;
  return (
    <>
      <Card title={t('learning.title')} aside={<SettingSource setting={learning} editable={editable} busy={busy} onReset={() => onReset('supplierLearning')} />}>
        <p className="muted">{t('learning.text')}</p>
        <Switch label={t('learning.label')} checked={learning.value} onCheckedChange={(supplierLearning) => onSave({ supplierLearning })} disabled={disabled} />
        <form
          className="form-row"
          onSubmit={(e) => {
            e.preventDefault();
            onSave({ supplierExamples: Number(count) });
          }}
        >
          <Field label={t('learning.examples')}>{(id) => <TextInput id={id} type="number" min={1} max={10} value={count} onChange={(e) => setCount(e.target.value)} disabled={disabled} />}</Field>
          <Button type="submit" disabled={disabled || Number(count) === examples.value}>
            {t('common.save')}
          </Button>
        </form>
      </Card>
      <Card title={t('learning.reviewTitle')} aside={<SettingSource setting={threshold} editable={editable} busy={busy} onReset={() => onReset('reviewThreshold')} />}>
        <p className="muted">{t('learning.reviewText')}</p>
        <form
          className="form-row"
          onSubmit={(e) => {
            e.preventDefault();
            onSave({ reviewThreshold: Number(percent) / 100 });
          }}
        >
          <Field label={t('learning.threshold')}>{(id) => <TextInput id={id} type="number" min={10} max={100} value={percent} onChange={(e) => setPercent(e.target.value)} disabled={disabled} />}</Field>
          <Button type="submit" disabled={disabled || Number(percent) === Math.round(threshold.value * 100)}>
            {t('common.save')}
          </Button>
        </form>
        <Switch label={t('learning.secondPass')} checked={secondPass.value} onCheckedChange={(reviewSecondPass) => onSave({ reviewSecondPass })} disabled={disabled} />
      </Card>
    </>
  );
}
