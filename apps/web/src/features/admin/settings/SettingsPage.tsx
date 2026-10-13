import { LoadingCard } from '../../../components/layout/LoadingCard';
import { Banner } from '../../../components/ui/Banner';
import { PageHeader } from '../../../components/ui/PageHeader';
import { useI18n } from '../../../i18n/useI18n';
import { settingOf } from '../../../lib/settingOf';
import { AccountsSettingCard } from './AccountsSettingCard';
import { AgentSettingCard } from './AgentSettingCard';
import { ModelSettingCard } from './ModelSettingCard';
import { OcrSettingsCard } from './OcrSettingsCard';
import { useAdminSettings } from './useAdminSettings';

export function SettingsPage() {
  const { t } = useI18n();
  const { settings, models, status, busy, save, reset } = useAdminSettings(t('admin.saved'));
  if (!settings) return <LoadingCard error={status?.tone === 'error' ? status.text : undefined} />;
  const { editable, options } = settings;
  const model = settingOf(settings, 'llmModel');
  const ocrLanguages = settingOf(settings, 'ocrLanguages');
  const ocrScale = settingOf(settings, 'ocrScale');
  const ocrPsm = settingOf(settings, 'ocrPsm');
  return (
    <div className="page page-narrow">
      <PageHeader title={t('admin.settings')} description={t('admin.settingsDescription')} />
      {!editable && <Banner tone="info">{t('admin.readOnlyDemo')}</Banner>}
      {status && <Banner tone={status.tone}>{status.text}</Banner>}
      <ModelSettingCard
        key={`model-${model.value}`}
        setting={model}
        models={models}
        editable={editable}
        busy={busy}
        onSave={(llmModel) => void save({ llmModel })}
        onReset={() => void reset('llmModel')}
      />
      <AgentSettingCard
        setting={settingOf(settings, 'agentEnabled')}
        editable={editable}
        busy={busy}
        onSave={(agentEnabled) => void save({ agentEnabled })}
        onReset={() => void reset('agentEnabled')}
      />
      <AccountsSettingCard
        setting={settingOf(settings, 'registrationOpen')}
        editable={editable}
        busy={busy}
        onSave={(registrationOpen) => void save({ registrationOpen })}
        onReset={() => void reset('registrationOpen')}
      />
      <OcrSettingsCard
        key={`ocr-${ocrLanguages.value.join('+')}-${ocrScale.value}-${ocrPsm.value}`}
        languages={ocrLanguages}
        scale={ocrScale}
        psm={ocrPsm}
        options={options}
        editable={editable}
        busy={busy}
        onSave={(values) => void save(values)}
        onReset={(key) => void reset(key)}
      />
    </div>
  );
}

