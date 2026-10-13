import { useState } from 'react';
import type { AdminModels, InstalledModel, SettingView } from '../../../api/types';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { Field } from '../../../components/ui/Field';
import { Select } from '../../../components/ui/Select';
import { useI18n } from '../../../i18n/useI18n';
import { SettingSource } from './SettingSource';

export interface ModelSettingCardProps {
  setting: SettingView<'llmModel'>;
  models?: AdminModels;
  editable: boolean;
  busy: boolean;
  onSave: (model: string) => void;
  onReset: () => void;
}

const baseName = (name: string) => name.replace(/:latest$/, '');

/** Pick an installed model; switching asks first, since it means reading every document again. */
export function ModelSettingCard({ setting, models, editable, busy, onSave, onReset }: ModelSettingCardProps) {
  const { t, formatPercent } = useI18n();
  const [choice, setChoice] = useState(setting.value);
  const installed = models?.models ?? [];
  const chosen: InstalledModel | undefined = installed.find((m) => baseName(m.name) === baseName(choice));
  const options = installed.map((m) => ({
    value: baseName(m.name),
    label: `${baseName(m.name)}${m.current ? ` · ${t('admin.model.current')}` : ''}`,
  }));
  const quality = chosen?.evaluated ? t('admin.model.confirmMeasured', { accuracy: formatPercent(chosen.evaluated.accuracy) }) : t('admin.model.confirmUnmeasured');

  return (
    <Card title={t('admin.model.title')} aside={<SettingSource setting={setting} editable={editable} busy={busy} onReset={onReset} />}>
      <p className="muted">{t('admin.model.text')}</p>
      {models && !models.reachable ? (
        <p className="error" role="alert">
          {t('admin.model.unreachable')}
        </p>
      ) : (
        <div className="setting-row">
          <Field label={t('admin.model.label')}>
            {(id) => <Select id={id} value={baseName(choice)} options={options.length ? options : [{ value: baseName(choice), label: baseName(choice) }]} onValueChange={setChoice} disabled={!editable || busy} />}
          </Field>
          {editable && (
            <ConfirmDialog
              trigger={
                <Button variant="primary" disabled={busy || baseName(choice) === baseName(setting.value)}>
                  {t('admin.save')}
                </Button>
              }
              title={t('admin.model.confirmTitle', { model: baseName(choice) })}
              description={t('admin.model.confirmText', { quality })}
              confirmLabel={t('admin.model.confirm')}
              onConfirm={() => onSave(baseName(choice))}
            />
          )}
        </div>
      )}
      {chosen && (
        <p className="muted small">
          {chosen.evaluated ? t('admin.model.measured', { accuracy: formatPercent(chosen.evaluated.accuracy), count: chosen.evaluated.documents }) : t('admin.model.notMeasured')}
        </p>
      )}
    </Card>
  );
}
