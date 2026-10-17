import { useEffect, useState, type FormEvent } from 'react';
import { LoadingCard } from '../../components/layout/LoadingCard';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { Select } from '../../components/ui/Select';
import { Switch } from '../../components/ui/Switch';
import { TextInput } from '../../components/ui/TextInput';
import { useI18n } from '../../i18n/useI18n';
import { errorMessage } from '../../lib/errorMessage';
import { integrationsApi, type TrackingProvider, type TrackingSettings } from './integrationsApi';
import type { Status } from './shared';

export function TrackingTab() {
  const { t } = useI18n();
  const [settings, setSettings] = useState<TrackingSettings>();
  const [error, setError] = useState<string>();
  const [enabled, setEnabled] = useState(false);
  const [provider, setProvider] = useState<TrackingProvider>('mock');
  const [endpoint, setEndpoint] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [scenario, setScenario] = useState<'consistent' | 'conflicting'>('consistent');
  const [status, setStatus] = useState<Status>();
  const [busy, setBusy] = useState(false);

  const load = (s: TrackingSettings) => {
    setSettings(s);
    setEnabled(s.enabled);
    setProvider(s.provider);
    setEndpoint(s.endpoint ?? '');
    setScenario(s.mockScenario);
    setApiKey('');
  };
  useEffect(() => {
    integrationsApi.tracking().then(load, (e: unknown) => setError(errorMessage(e)));
  }, []);
  if (!settings) return <LoadingCard error={error} />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setStatus(undefined);
    try {
      load(await integrationsApi.saveTracking({ enabled, provider, endpoint: endpoint.trim() || null, ...(apiKey ? { apiKey } : {}), mockScenario: scenario }));
      setStatus({ tone: 'ok', text: t('integrations.tracking.saved') });
    } catch (err) {
      setStatus({ tone: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={t('integrations.tracking.title')}>
      <p className="muted">{t('integrations.tracking.intro')}</p>
      <form className="stack-form" onSubmit={(e) => void submit(e)} noValidate>
        <Switch label={t('integrations.tracking.enabled')} checked={enabled} onCheckedChange={setEnabled} />
        <Field label={t('integrations.tracking.provider')}>
          {(id) => <Select id={id} value={provider} options={settings.providers.map((p) => ({ value: p, label: t(`integrations.tracking.providers.${p}`) }))} onValueChange={setProvider} />}
        </Field>
        {provider === 'mock' ? (
          <Field label={t('integrations.tracking.scenario')}>
            {(id) => <Select id={id} value={scenario} options={(['consistent', 'conflicting'] as const).map((s) => ({ value: s, label: t(`integrations.tracking.scenarios.${s}`) }))} onValueChange={setScenario} />}
          </Field>
        ) : (
          <>
            <Field label={t('integrations.tracking.endpoint')}>
              {(id) => <TextInput id={id} type="url" value={endpoint} placeholder="https://api.example.com/containers/{container}/events" onChange={(e) => setEndpoint(e.target.value)} spellCheck={false} />}
            </Field>
            <p className="muted small">{t('integrations.tracking.endpointHelp')}</p>
            <Field label={t('integrations.tracking.apiKey')}>
              {(id) => <TextInput id={id} type="password" value={apiKey} placeholder={settings.hasApiKey ? t('integrations.tracking.apiKeySaved') : ''} onChange={(e) => setApiKey(e.target.value)} autoComplete="new-password" />}
            </Field>
          </>
        )}
        {status && <Banner tone={status.tone}>{status.text}</Banner>}
        <div>
          <Button type="submit" variant="primary" disabled={busy}>
            {t('integrations.tracking.save')}
          </Button>
        </div>
      </form>
      <h3 className="section-title">{t('integrations.tracking.rules')}</h3>
      <ul className="plain-list">
        <li>{t('integrations.tracking.CT1')}</li>
        <li>{t('integrations.tracking.CT2')}</li>
        <li>{t('integrations.tracking.CT3')}</li>
      </ul>
      <p className="muted small">{t('integrations.tracking.note')}</p>
    </Card>
  );
}
