import { Select } from '../../components/ui/Select';
import { TextInput } from '../../components/ui/TextInput';
import { ToggleChips } from '../../components/ui/ToggleChips';
import { DESTINATION_FILTERS, STATUS_FILTERS } from '../../constants/shipmentFilters';
import { useI18n } from '../../i18n/useI18n';
import type { ShipmentFilterState } from '../../lib/filterShipments';

export interface ShipmentFiltersProps {
  value: ShipmentFilterState;
  onChange: (value: ShipmentFilterState) => void;
}

export function ShipmentFilters({ value, onChange }: ShipmentFiltersProps) {
  const { t } = useI18n();
  return (
    <div className="filters">
      <ToggleChips
        value={value.status}
        options={STATUS_FILTERS.map((f) => ({ value: f.value, label: t(f.labelKey) }))}
        onValueChange={(status) => onChange({ ...value, status })}
        ariaLabel={t('shipments.filterStatus')}
      />
      <div className="filters-right">
        <Select
          value={value.destination}
          options={DESTINATION_FILTERS.map((f) => ({ value: f.value, label: t(f.labelKey) }))}
          onValueChange={(destination) => onChange({ ...value, destination })}
          ariaLabel={t('shipments.filterDestination')}
        />
        <TextInput type="search" value={value.query} onChange={(e) => onChange({ ...value, query: e.target.value })} placeholder={t('shipments.search')} aria-label={t('shipments.search')} />
      </div>
    </div>
  );
}
