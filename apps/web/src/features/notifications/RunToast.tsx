import { Cross2Icon } from '@radix-ui/react-icons';
import { Toast } from 'radix-ui';
import { useI18n } from '../../i18n/useI18n';
import { cx } from '../../lib/cx';
import type { RunGroup } from './groupRuns';
import { notificationText, type GroupInfo } from './notificationText';

export interface RunToastProps {
  group: RunGroup;
  info: GroupInfo;
  /** Called once it is closed (timeout, swipe, Escape, the close button or the action). */
  onClosed: () => void;
}

/** One finished run (or burst of runs) of a shipment, with a link to it. Announced politely. */
export function RunToast({ group, info, onClosed }: RunToastProps) {
  const { t } = useI18n();
  const text = notificationText(group, info, t);
  const failed = group.outcome === 'extractionFailed' || group.outcome === 'validationFailed';
  return (
    <Toast.Root className={cx('toast', failed && 'toast-error')} type="background" onOpenChange={(open) => !open && onClosed()}>
      <Toast.Title className="toast-title">{text.title}</Toast.Title>
      {text.body && <Toast.Description className="toast-body">{text.body}</Toast.Description>}
      <Toast.Action asChild altText={t('notify.openShipment', { shipment: text.shipment })}>
        <a className="btn btn-sm toast-action" href={`#/app/s/${group.shipmentId}`} aria-label={t('notify.openShipment', { shipment: text.shipment })}>
          {t('notify.open')}
        </a>
      </Toast.Action>
      <Toast.Close className="btn btn-ghost icon-btn toast-close" aria-label={t('notify.dismiss')}>
        <Cross2Icon aria-hidden />
      </Toast.Close>
    </Toast.Root>
  );
}
