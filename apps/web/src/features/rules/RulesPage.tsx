import { LoadingCard } from '../../components/layout/LoadingCard';
import { Card } from '../../components/ui/Card';
import { PageHeader } from '../../components/ui/PageHeader';
import { Tabs } from '../../components/ui/Tabs';
import { RuleCatalogTable } from './RuleCatalogTable';
import { useRuleCatalog } from './useRuleCatalog';

export function RulesPage() {
  const { rules, error } = useRuleCatalog();
  if (!rules) return <LoadingCard error={error} />;
  return (
    <div className="page">
      <PageHeader
        title="Rules"
        description="Deterministic checks run on every validation. Cross-document rules (X) apply to both destinations; C rules follow CBSA, U rules follow CBP. Each finding links to the regulation behind it."
      />
      <Card>
        <Tabs
          ariaLabel="Destination"
          defaultValue="CA"
          items={[
            { value: 'CA', label: `Canada · CBSA (${rules.CA.length})`, content: <RuleCatalogTable rules={rules.CA} /> },
            { value: 'US', label: `United States · CBP (${rules.US.length})`, content: <RuleCatalogTable rules={rules.US} /> },
          ]}
        />
      </Card>
    </div>
  );
}
