import { useState } from 'react';
import type { AdminSettings, SettingValues, SettingView } from '../../../api/types';
import { Banner } from '../../../components/ui/Banner';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Checkbox } from '../../../components/ui/Checkbox';
import { Field } from '../../../components/ui/Field';
import { Select } from '../../../components/ui/Select';
import type { MessageKey } from '../../../i18n/keys';
import { useI18n } from '../../../i18n/useI18n';
import { SettingSource } from './SettingSource';

export interface OcrSettingsCardProps {
  languages: SettingView<'ocrLanguages'>;
  scale: SettingView<'ocrScale'>;
  psm: SettingView<'ocrPsm'>;
  options: AdminSettings['options'];
  editable: boolean;
  busy: boolean;
  onSave: (values: Pick<SettingValues, 'ocrLanguages' | 'ocrScale' | 'ocrPsm'>) => void;
  onReset: (key: 'ocrLanguages' | 'ocrScale' | 'ocrPsm') => void;
}

/** PDF points are 72 per inch, so a render scale of 4 reads the page at 288 dpi. */
const DPI_PER_SCALE = 72;

export function OcrSettingsCard({ languages, scale, psm, options, editable, busy, onSave, onReset }: OcrSettingsCardProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState({ ocrLanguages: languages.value, ocrScale: scale.value, ocrPsm: psm.value });
  const languageName = (code: string) => {
    const key = `admin.ocr.languageNames.${code}` as MessageKey;
    return t(key) === key ? code : t(key);
  };
  const toggle = (code: string, on: boolean) =>
    setDraft((d) => ({ ...d, ocrLanguages: on ? [...d.ocrLanguages, code] : d.ocrLanguages.filter((c) => c !== code) }));
  const changed = draft.ocrScale !== scale.value || draft.ocrPsm !== psm.value || [...draft.ocrLanguages].sort().join() !== [...languages.value].sort().join();
  const scales = Array.from({ length: options.ocrScale.max - options.ocrScale.min + 1 }, (_, i) => String(options.ocrScale.min + i));
  const noLanguage = draft.ocrLanguages.length === 0;

  return (
    <Card title={t('admin.ocr.title')}>
      <p className="muted">{t('admin.ocr.text')}</p>
      <div className="stack-form">
        <fieldset className="fieldset">
          <legend className="field-label">
            {t('admin.ocr.languages')} <SettingSource setting={languages} editable={editable} busy={busy} onReset={() => onReset('ocrLanguages')} />
          </legend>
          <div className="checkbox-row">
            {options.ocrLanguages.map((code) => (
              <Checkbox key={code} label={languageName(code)} checked={draft.ocrLanguages.includes(code)} onCheckedChange={(on) => toggle(code, on)} disabled={!editable || busy} />
            ))}
          </div>
        </fieldset>
        <div className="setting-row">
          <Field label={t('admin.ocr.scale')}>
            {(id) => (
              <Select
                id={id}
                value={String(draft.ocrScale)}
                options={scales.map((s) => ({ value: s, label: `${s}×` }))}
                onValueChange={(v) => setDraft((d) => ({ ...d, ocrScale: Number(v) }))}
                disabled={!editable || busy}
              />
            )}
          </Field>
          <SettingSource setting={scale} editable={editable} busy={busy} onReset={() => onReset('ocrScale')} />
        </div>
        <p className="muted small">{t('admin.ocr.scaleHint', { scale: draft.ocrScale, dpi: draft.ocrScale * DPI_PER_SCALE })}</p>
        <div className="setting-row">
          <Field label={t('admin.ocr.psm')}>
            {(id) => (
              <Select
                id={id}
                value={draft.ocrPsm}
                options={options.ocrPsm.map((v) => ({ value: v, label: t(`admin.ocr.psmOptions.${v}` as MessageKey) }))}
                onValueChange={(v) => setDraft((d) => ({ ...d, ocrPsm: v }))}
                disabled={!editable || busy}
              />
            )}
          </Field>
          <SettingSource setting={psm} editable={editable} busy={busy} onReset={() => onReset('ocrPsm')} />
        </div>
        {noLanguage && <Banner tone="error">{t('admin.ocr.noLanguage')}</Banner>}
        {editable && (
          <div>
            <Button variant="primary" disabled={busy || !changed || noLanguage} onClick={() => onSave(draft)}>
              {t('admin.save')}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
