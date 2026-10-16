import { useState } from 'react';
import { LoadingCard } from '../../../components/layout/LoadingCard';
import { Banner } from '../../../components/ui/Banner';
import { PageHeader } from '../../../components/ui/PageHeader';
import { Tabs } from '../../../components/ui/Tabs';
import { useI18n } from '../../../i18n/useI18n';
import { settingOf } from '../../../lib/settingOf';
import { AccountsSettingCard } from './AccountsSettingCard';
import { AgentSettingCard } from './AgentSettingCard';
import { ModelSettingCard } from './ModelSettingCard';
import { MailboxSettingsCard } from './MailboxSettingsCard';
import { OcrSettingsCard } from './OcrSettingsCard';
import { useAdminSettings } from './useAdminSettings';

type SettingsTab = 'model' | 'accounts' | 'ocr' | 'mail';

export function SettingsPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<SettingsTab>('model');
  const { settings, models, status, busy, save, reset } = useAdminSettings(t('admin.saved'));
  if (!settings) return <LoadingCard error={status?.tone === 'error' ? status.text : undefined} />;
  const { editable, options } = settings;
  const model = settingOf(settings, 'llmModel');
  const ocrLanguages = settingOf(settings, 'ocrLanguages');
  const ocrScale = settingOf(settings, 'ocrScale');
  const ocrPsm = settingOf(settings, 'ocrPsm');
  const ocrEngine = settingOf(settings, 'ocrEngine');
  const ocrUrl = settingOf(settings, 'ocrUrl');
  return (
    <div className="page page-narrow">
      <PageHeader title={t('admin.settings')} description={t('admin.settingsDescription')} />
      {!editable && <Banner tone="info">{t('admin.readOnlyDemo')}</Banner>}
      {status && <Banner tone={status.tone}>{status.text}</Banner>}
      <Tabs
        ariaLabel={t('admin.settingsTabs.label')}
        defaultValue="model"
        value={tab}
        onValueChange={setTab}
        items={[
          {
            value: 'model',
            label: t('admin.settingsTabs.model'),
            content: (
              <>
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
              </>
            ),
          },
          {
            value: 'accounts',
            label: t('admin.settingsTabs.accounts'),
            content: (
            <AccountsSettingCard
              setting={settingOf(settings, 'registrationOpen')}
              editable={editable}
              busy={busy}
              onSave={(registrationOpen) => void save({ registrationOpen })}
              onReset={() => void reset('registrationOpen')}
            />
            ),
          },
          {
            value: 'ocr',
            label: t('admin.settingsTabs.ocr'),
            content: (
            <OcrSettingsCard
              key={`ocr-${ocrEngine.value}-${ocrUrl.value}-${ocrLanguages.value.join('+')}-${ocrScale.value}-${ocrPsm.value}`}
              engine={ocrEngine}
              url={ocrUrl}
              server={settings.ocrServer}
              languages={ocrLanguages}
              scale={ocrScale}
              psm={ocrPsm}
              options={options}
              editable={editable}
              busy={busy}
              onSave={(values) => void save(values)}
              onReset={(key) => void reset(key)}
            />
            ),
          },
          { value: 'mail', label: t('admin.settingsTabs.mail'), content: <MailboxSettingsCard /> },
        ]}
      />
    </div>
  );
}

