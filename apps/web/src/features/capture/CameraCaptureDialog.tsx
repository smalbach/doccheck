import { Cross2Icon } from '@radix-ui/react-icons';
import { Dialog } from 'radix-ui';
import type { ReactNode } from 'react';
import { useI18n } from '../../i18n/useI18n';
import { ScanSession } from './ScanSession';

export interface CameraCaptureDialogProps {
  /** The element that opens the dialog; it must accept a ref (Button does). */
  trigger: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The scanned pages as one PDF. */
  onDone: (pdf: File) => void;
}

/**
 * Scans paper pages with the camera into one PDF. The session lives inside the dialog content, so
 * closing the dialog unmounts it: the camera stops and the captured pages are dropped.
 */
export function CameraCaptureDialog({ trigger, open, onOpenChange, onDone }: CameraCaptureDialogProps) {
  const { t } = useI18n();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog capture-dialog">
          <div className="capture-head">
            <Dialog.Title className="dialog-title">{t('capture.title')}</Dialog.Title>
            <Dialog.Close className="btn btn-ghost icon-btn" aria-label={t('common.close')}>
              <Cross2Icon aria-hidden />
            </Dialog.Close>
          </div>
          <Dialog.Description className="dialog-description">{t('capture.description')}</Dialog.Description>
          <ScanSession onDone={onDone} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
