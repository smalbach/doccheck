import type { ReactNode } from 'react';
import type { Shipment } from '../../api/types';
import { BackLink } from '../../components/layout/BackLink';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { DESTINATION_LABEL_KEY } from '../../constants/destinations';
import { TRANSPORT_MODE_KEY } from '../../constants/transportModes';
import { useI18n } from '../../i18n/useI18n';
import { DeleteShipmentButton } from './DeleteShipmentButton';

export interface ShipmentHeaderProps {
  shipment: Shipment;
  canDelete: boolean;
  extracting: boolean;
  onDelete: () => void;
  /** More buttons next to Delete (edit, export). */
  actions?: ReactNode;
}

export function ShipmentHeader({ shipment, canDelete, extracting, onDelete, actions }: ShipmentHeaderProps) {
  const { t } = useI18n();
  return (
    <div className="title-row">
      <div>
        <BackLink />
        <h1>{shipment.reference ?? t('shipment.untitled', { id: shipment.id.slice(0, 8) })}</h1>
        <p className="muted">
          {shipment.destination ? t(DESTINATION_LABEL_KEY[shipment.destination]) : t('destinations.none')}
          {shipment.transportMode && ` · ${t(TRANSPORT_MODE_KEY[shipment.transportMode])}`} · <StatusBadge status={shipment.status} />
        </p>
      </div>
      <div className="title-actions">
        {actions}
        {canDelete && <DeleteShipmentButton disabled={extracting} onConfirm={onDelete} />}
      </div>
    </div>
  );
}
