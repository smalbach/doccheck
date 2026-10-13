import { useState } from 'react';
import type { GoodsFilterState } from '../../constants/insights';
import { DataPage } from './DataPage';
import { GoodsPanel } from './GoodsPanel';

/** Every invoice line; `initial` comes from the link that opened it ("#/app/goods?origin=CN"). */
export function GoodsPage({ initial }: { initial: GoodsFilterState }) {
  const [filters, setFilters] = useState(initial);
  return (
    <DataPage titleKey="insights.pages.goods.title" descriptionKey="insights.pages.goods.description">
      {(destination) => <GoodsPanel destination={destination} filters={filters} onFiltersChange={setFilters} />}
    </DataPage>
  );
}
