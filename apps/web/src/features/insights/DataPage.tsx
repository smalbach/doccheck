import type { ReactNode } from 'react';
import type { Destination } from '../../api/types';
import { Card } from '../../components/ui/Card';
import { PageHeader } from '../../components/ui/PageHeader';
import { Select } from '../../components/ui/Select';
import { DESTINATION_FILTERS } from '../../constants/shipmentFilters';
import { useDataDestination } from '../../hooks/useDataDestination';
import type { MessageKey } from '../../i18n/keys';
import { useI18n } from '../../i18n/useI18n';

export interface DataPageProps {
  titleKey: MessageKey;
  descriptionKey: MessageKey;
  /** The page body for the destination picked in the header (undefined: any). */
  children: (destination: Destination | undefined) => ReactNode;
}

/** A page of the Data section: title, description, the destination filter they share, and a card. */
export function DataPage({ titleKey, descriptionKey, children }: DataPageProps) {
  const { t } = useI18n();
  const [filter, setFilter] = useDataDestination();
  return (
    <div className="page">
      <PageHeader
        title={t(titleKey)}
        description={t(descriptionKey)}
        actions={
          <Select
            value={filter}
            options={DESTINATION_FILTERS.map((f) => ({ value: f.value, label: t(f.labelKey) }))}
            onValueChange={setFilter}
            ariaLabel={t('shipments.filterDestination')}
          />
        }
      />
      <Card>{children(filter === 'any' ? undefined : filter)}</Card>
    </div>
  );
}
