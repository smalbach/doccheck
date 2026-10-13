import type { Shipment } from '../../api/types';
import { BackLink } from '../../components/layout/BackLink';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { DESTINATION_LABEL } from '../../constants/destinations';
import { DeleteShipmentButton } from './DeleteShipmentButton';

export interface ShipmentHeaderProps {
  shipment: Shipment;
  canDelete: boolean;
  extracting: boolean;
  onDelete: () => void;
}

export function ShipmentHeader({ shipment, canDelete, extracting, onDelete }: ShipmentHeaderProps) {
  return (
    <div className="title-row">
      <div>
        <BackLink />
        <h1>{shipment.reference ?? `Shipment ${shipment.id.slice(0, 8)}`}</h1>
        <p className="muted">
          {shipment.destination ? DESTINATION_LABEL[shipment.destination] : 'No destination'} · <StatusBadge status={shipment.status} />
        </p>
      </div>
      {canDelete && <DeleteShipmentButton disabled={extracting} onConfirm={onDelete} />}
    </div>
  );
}
