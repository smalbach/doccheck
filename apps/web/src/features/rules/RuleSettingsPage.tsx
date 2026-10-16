import { BackLink } from '../../components/layout/BackLink';
import { LoadingCard } from '../../components/layout/LoadingCard';
import { PageHeader } from '../../components/ui/PageHeader';
import { useI18n } from '../../i18n/useI18n';
import { PurchaseOrdersCard } from './PurchaseOrdersCard';
import { RuleSettingsForm } from './RuleSettingsForm';
import { useRuleSettings } from './useRuleSettings';
import './rule-settings.css';

export function RuleSettingsPage() {
  const { t } = useI18n();
  const { settings, setSettings, orders, setOrders, error } = useRuleSettings();
  if (!settings || !orders) return <LoadingCard error={error} />;
  return (
    <div className="page">
      <PageHeader eyebrow={<BackLink href="#/app/rules" label={t('ruleSettings.back')} />} title={t('ruleSettings.title')} description={t('ruleSettings.description')} />
      <RuleSettingsForm settings={settings} onSaved={setSettings} />
      <PurchaseOrdersCard orders={orders} onChange={setOrders} />
    </div>
  );
}
