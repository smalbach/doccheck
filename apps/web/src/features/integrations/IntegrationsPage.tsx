import { useState } from 'react';
import { Card } from '../../components/ui/Card';
import { PageHeader } from '../../components/ui/PageHeader';
import { Tabs } from '../../components/ui/Tabs';
import { useQuery } from '../../hooks/useQuery';
import { ForbiddenPage } from '../admin/ForbiddenPage';
import { useOrg } from '../team/useOrg';
import { useI18n } from '../../i18n/useI18n';
import { ApiKeysTab } from './ApiKeysTab';
import { ChatAlertsTab } from './ChatAlertsTab';
import { IngestionTab } from './IngestionTab';
import { integrationsApi, type ExportFormat } from './integrationsApi';
import { TrackingTab } from './TrackingTab';
import { WebhooksTab } from './WebhooksTab';

type Tab = 'keys' | 'webhooks' | 'chat' | 'ingestion' | 'tracking' | 'exports';
const TAB_KEY = 'doccheck.integrations.tab';
const TABS: Tab[] = ['keys', 'webhooks', 'chat', 'ingestion', 'tracking', 'exports'];

function storedTab(initial?: string): Tab {
  if (initial && TABS.includes(initial as Tab)) return initial as Tab;
  try {
    const v = localStorage.getItem(TAB_KEY) as Tab | null;
    return v && TABS.includes(v) ? v : 'keys';
  } catch {
    return 'keys';
  }
}

/** API keys, webhooks, chat alerts, watched folders, container tracking and exports of the account. */
export function IntegrationsPage({ initialTab }: { initialTab?: string }) {
  const { org, can } = useOrg();
  // Owners and admins only (the API checks integrations.manage on every call anyway).
  if (org && !can('integrations.manage')) return <ForbiddenPage />;
  return <Integrations initialTab={initialTab} />;
}

function Integrations({ initialTab }: { initialTab?: string }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>(() => storedTab(initialTab));
  const { data: overview } = useQuery('integrations-overview', () => integrationsApi.overview());
  const pick = (next: Tab) => {
    setTab(next);
    try {
      localStorage.setItem(TAB_KEY, next);
    } catch {}
  };
  return (
    <div className="page page-narrow">
      <PageHeader title={t('integrations.title')} description={t('integrations.description')} />
      <Tabs
        ariaLabel={t('integrations.tabsLabel')}
        defaultValue="keys"
        value={tab}
        onValueChange={pick}
        items={[
          { value: 'keys', label: t('integrations.tabs.keys'), content: <ApiKeysTab /> },
          { value: 'webhooks', label: t('integrations.tabs.webhooks'), content: <WebhooksTab deliveryMode={overview?.deliveryMode} /> },
          { value: 'chat', label: t('integrations.tabs.chat'), content: <ChatAlertsTab /> },
          { value: 'ingestion', label: t('integrations.tabs.ingestion'), content: <IngestionTab localRoot={overview?.localRoot} /> },
          { value: 'tracking', label: t('integrations.tabs.tracking'), content: <TrackingTab /> },
          { value: 'exports', label: t('integrations.tabs.exports'), content: <ExportsInfo connectors={overview?.connectors ?? []} /> },
        ]}
      />
    </div>
  );
}

function ExportsInfo({ connectors }: { connectors: { id: string; name: string; formats: ExportFormat[] }[] }) {
  const { t } = useI18n();
  return (
    <Card title={t('integrations.tabs.exports')}>
      <p>{t('integrations.exports.intro')}</p>
      <ul className="plain-list">
        {(['cargowise-xml', 'x12-856', 'x12-310'] as const).map((f) => (
          <li key={f}>{t(`integrations.exports.formats.${f}`)}</li>
        ))}
      </ul>
      <p className="muted">{t('integrations.exports.where')}</p>
      <h3 className="section-title">{t('integrations.exports.connectors')}</h3>
      <p className="muted">{t('integrations.exports.connectorsText')}</p>
      <ul className="plain-list">
        {connectors.map((c) => (
          <li key={c.id}>
            <code className="mono">{c.id}</code> · {c.name}
          </li>
        ))}
      </ul>
    </Card>
  );
}
