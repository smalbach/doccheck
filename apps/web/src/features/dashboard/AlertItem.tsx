import { ClockIcon, CrossCircledIcon, EnvelopeClosedIcon, ExclamationTriangleIcon, EyeOpenIcon, GlobeIcon, UpdateIcon } from '@radix-ui/react-icons';
import type { ComponentType } from 'react';
import type { Alert, AlertKind } from '../../api/types';
import { useI18n } from '../../i18n/useI18n';
import { alertMessage } from '../../lib/alertMessage';
import { cx } from '../../lib/cx';

type Tone = 'critical' | 'high' | 'medium' | 'low';

/** Icon and color of each kind; the kind is also written out, so the color is never the only cue. */
const KINDS: Record<AlertKind, { icon: ComponentType<{ 'aria-hidden'?: boolean; className?: string }>; tone: Tone }> = {
  critical: { icon: ExclamationTriangleIcon, tone: 'critical' },
  'failed-document': { icon: CrossCircledIcon, tone: 'high' },
  ocr: { icon: EyeOpenIcon, tone: 'medium' },
  'stale-destination': { icon: GlobeIcon, tone: 'medium' },
  'not-validated': { icon: UpdateIcon, tone: 'low' },
  'mail-reply': { icon: EnvelopeClosedIcon, tone: 'medium' },
  'mail-overdue': { icon: ClockIcon, tone: 'low' },
  'mail-failed': { icon: CrossCircledIcon, tone: 'high' },
};

/** One alert, linking to its shipment (or, for email, to the conversation). */
export function AlertItem({ alert }: { alert: Alert }) {
  const { t, formatDateTime } = useI18n();
  const { icon: Icon, tone } = KINDS[alert.kind];
  const shipment = alert.reference ?? t('shipment.untitled', { id: alert.shipmentId.slice(0, 8) });
  return (
    <li className={cx('alert-item', `alert-item-${tone}`)}>
      <a href={'threadId' in alert.detail ? `#/app/inbox/${alert.detail.threadId}` : `#/app/s/${alert.shipmentId}`} className="alert-item-link">
        <Icon aria-hidden className="alert-item-icon" />
        <span className="alert-item-text">
          <span>
            <strong>{t(`dashboard.alerts.kinds.${alert.kind}`)}</strong>
            <span className="muted"> · {shipment}</span>
          </span>
          <span className="muted small">{alertMessage(alert, t)}</span>
        </span>
        <time className="muted small alert-item-time" dateTime={alert.at}>
          {formatDateTime(alert.at)}
        </time>
      </a>
    </li>
  );
}
