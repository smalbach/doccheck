import { Cross2Icon } from '@radix-ui/react-icons';
import { Dialog } from 'radix-ui';
import type { ReactNode } from 'react';
import { useI18n } from '../../i18n/useI18n';

export interface SheetProps {
  title: string;
  onClose: () => void;
  /** Controls next to the title (e.g. a pager). */
  actions?: ReactNode;
  children: ReactNode;
}

/** A panel sliding in from the right, over the page: focus is trapped, Escape and the overlay close it. */
export function Sheet({ title, onClose, actions, children }: SheetProps) {
  const { t } = useI18n();
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="sheet-overlay" />
        <Dialog.Content className="sheet" aria-describedby={undefined}>
          <header className="sheet-head">
            <Dialog.Title className="sheet-title">{title}</Dialog.Title>
            {actions}
            <Dialog.Close className="btn btn-ghost icon-btn" aria-label={t('common.close')}>
              <Cross2Icon />
            </Dialog.Close>
          </header>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
