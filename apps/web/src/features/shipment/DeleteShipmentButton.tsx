import { TrashIcon } from '@radix-ui/react-icons';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Tooltip } from '../../components/ui/Tooltip';

export interface DeleteShipmentButtonProps {
  disabled: boolean;
  onConfirm: () => void;
}

export function DeleteShipmentButton({ disabled, onConfirm }: DeleteShipmentButtonProps) {
  if (disabled) {
    return (
      <Tooltip content="Wait until extraction finishes">
        {/* A disabled button gets no pointer events, so the hint sits on a wrapper. */}
        <span tabIndex={0}>
          <Button variant="danger" disabled>
            <TrashIcon aria-hidden /> Delete
          </Button>
        </span>
      </Tooltip>
    );
  }
  return (
    <ConfirmDialog
      trigger={
        <Button variant="danger">
          <TrashIcon aria-hidden /> Delete
        </Button>
      }
      title="Delete this shipment?"
      description="Its PDFs, extractions, ISF and findings are removed too. This cannot be undone."
      confirmLabel="Delete shipment"
      onConfirm={onConfirm}
    />
  );
}
