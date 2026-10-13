import { TrashIcon } from '@radix-ui/react-icons';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Tooltip } from '../../components/ui/Tooltip';
import { useI18n } from '../../i18n/useI18n';

export interface DeleteShipmentButtonProps {
  disabled: boolean;
  onConfirm: () => void;
}

export function DeleteShipmentButton({ disabled, onConfirm }: DeleteShipmentButtonProps) {
  const { t } = useI18n();
  if (disabled) {
    return (
      <Tooltip content={t('shipment.deleteWait')}>
        {/* A disabled button gets no pointer events, so the hint sits on a wrapper. */}
        <span tabIndex={0}>
          <Button variant="danger" disabled>
            <TrashIcon aria-hidden /> {t('shipment.delete')}
          </Button>
        </span>
      </Tooltip>
    );
  }
  return (
    <ConfirmDialog
      trigger={
        <Button variant="danger">
          <TrashIcon aria-hidden /> {t('shipment.delete')}
        </Button>
      }
      title={t('shipment.deleteTitle')}
      description={t('shipment.deleteText')}
      confirmLabel={t('shipment.deleteConfirm')}
      onConfirm={onConfirm}
    />
  );
}
