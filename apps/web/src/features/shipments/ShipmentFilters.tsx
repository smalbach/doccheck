import { Select } from '../../components/ui/Select';
import { TextInput } from '../../components/ui/TextInput';
import { ToggleChips } from '../../components/ui/ToggleChips';
import { DESTINATION_FILTERS, STATUS_FILTERS } from '../../constants/shipmentFilters';
import type { ShipmentFilterState } from '../../lib/filterShipments';

export interface ShipmentFiltersProps {
  value: ShipmentFilterState;
  onChange: (value: ShipmentFilterState) => void;
}

export function ShipmentFilters({ value, onChange }: ShipmentFiltersProps) {
  return (
    <div className="filters">
      <ToggleChips value={value.status} options={STATUS_FILTERS} onValueChange={(status) => onChange({ ...value, status })} ariaLabel="Filter by status" />
      <div className="filters-right">
        <Select value={value.destination} options={DESTINATION_FILTERS} onValueChange={(destination) => onChange({ ...value, destination })} ariaLabel="Filter by destination" />
        <TextInput type="search" value={value.query} onChange={(e) => onChange({ ...value, query: e.target.value })} placeholder="Search reference or ID" aria-label="Search shipments" />
      </div>
    </div>
  );
}
