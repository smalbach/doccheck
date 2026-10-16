import type { ShipmentPage } from '../../api/types';
import { Select } from '../../components/ui/Select';
import { TextInput } from '../../components/ui/TextInput';
import { ToggleChips } from '../../components/ui/ToggleChips';
import { DESTINATION_FILTERS, DUE_FILTERS, STATUS_FILTERS, type DueFilter, type ShipmentFilterState } from '../../constants/shipmentFilters';
import { Switch } from '../../components/ui/Switch';
import { useI18n } from '../../i18n/useI18n';

export interface ShipmentFiltersProps {
  value: ShipmentFilterState;
  /** Shipments per status group, shown on the chips. */
  counts: ShipmentPage['summary'];
  onChange: (value: ShipmentFilterState) => void;
}

export function ShipmentFilters({ value, counts, onChange }: ShipmentFiltersProps) {
  const { t } = useI18n();
  return (
    <div className="filters">
      <ToggleChips
        value={value.status}
        options={STATUS_FILTERS.map((f) => ({ value: f.value, label: `${t(f.labelKey)} (${counts[f.value]})` }))}
        onValueChange={(status) => onChange({ ...value, status })}
        ariaLabel={t('shipments.filterStatus')}
      />
      <div className="filters-right">
        <Switch label={t('team.filters.mine')} checked={!!value.mine} onCheckedChange={(mine) => onChange({ ...value, mine })} />
        <Select<DueFilter>
          value={value.due ?? 'any'}
          options={DUE_FILTERS.map((f) => ({ value: f.value, label: f.value === 'overdue' && counts.overdue !== undefined ? `${t(f.labelKey)} (${counts.overdue})` : t(f.labelKey) }))}
          onValueChange={(due) => onChange({ ...value, due })}
          ariaLabel={t('team.filters.due')}
        />
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
