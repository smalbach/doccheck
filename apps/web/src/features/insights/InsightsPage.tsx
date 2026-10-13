import { useState } from 'react';
import type { Destination } from '../../api/types';
import { Card } from '../../components/ui/Card';
import { PageHeader } from '../../components/ui/PageHeader';
import { Select } from '../../components/ui/Select';
import { Tabs } from '../../components/ui/Tabs';
import { INITIAL_GOODS_FILTERS, INSIGHTS_TABS, type GoodsFilterState, type InsightsTab } from '../../constants/insights';
import { DESTINATION_FILTERS, type DestinationFilter } from '../../constants/shipmentFilters';
import { useI18n } from '../../i18n/useI18n';
import { GoodsPanel } from './GoodsPanel';
import { ShipmentDataPanel } from './ShipmentDataPanel';
import { SummaryPanel } from './SummaryPanel';

/** What the documents of all the user's shipments say, in one place: totals, every invoice line, each shipment's figures. */
export function InsightsPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<InsightsTab>('summary');
  const [destinationFilter, setDestinationFilter] = useState<DestinationFilter>('any');
  const [goodsFilters, setGoodsFilters] = useState<GoodsFilterState>(INITIAL_GOODS_FILTERS);
  const destination: Destination | undefined = destinationFilter === 'any' ? undefined : destinationFilter;

  // A row of the summary opens the goods tab filtered on it.
  const showGoods = (filter: Partial<GoodsFilterState>) => {
    setGoodsFilters({ ...INITIAL_GOODS_FILTERS, ...filter });
    setTab('goods');
  };

  const panels = {
    summary: <SummaryPanel destination={destination} onShowGoods={showGoods} />,
    goods: <GoodsPanel destination={destination} filters={goodsFilters} onFiltersChange={setGoodsFilters} />,
    shipments: <ShipmentDataPanel destination={destination} />,
  };
  return (
    <div className="page">
      <PageHeader
        title={t('insights.title')}
        description={t('insights.description')}
        actions={
          <Select
            value={destinationFilter}
            options={DESTINATION_FILTERS.map((f) => ({ value: f.value, label: t(f.labelKey) }))}
            onValueChange={setDestinationFilter}
            ariaLabel={t('shipments.filterDestination')}
          />
        }
      />
      <Card>
        <Tabs
          value={tab}
          onValueChange={setTab}
          defaultValue="summary"
          ariaLabel={t('insights.title')}
          items={INSIGHTS_TABS.map((item) => ({ value: item.value, label: t(item.labelKey), content: panels[item.value] }))}
        />
      </Card>
    </div>
  );
}
