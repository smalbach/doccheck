import { LoadingCard } from '../../components/layout/LoadingCard';
import { Card } from '../../components/ui/Card';
import { PageHeader } from '../../components/ui/PageHeader';
import { Tabs } from '../../components/ui/Tabs';
import { DESTINATION_LABEL_KEY, DESTINATIONS } from '../../constants/destinations';
import { useI18n } from '../../i18n/useI18n';
import { RuleCatalogTable } from './RuleCatalogTable';
import { useRuleCatalog } from './useRuleCatalog';

export function RulesPage() {
  const { t } = useI18n();
  const { rules, error } = useRuleCatalog();
  if (!rules) return <LoadingCard error={error} />;
  return (
    <div className="page">
      <PageHeader title={t('rules.title')} description={t('rules.description')} />
      <Card>
        <Tabs
          ariaLabel={t('rules.destination')}
          defaultValue="CA"
          items={DESTINATIONS.map((d) => ({
            value: d,
            label: t('rules.tab', { label: t(DESTINATION_LABEL_KEY[d]), count: rules[d].length }),
            content: <RuleCatalogTable rules={rules[d]} />,
          }))}
        />
      </Card>
    </div>
  );
}
