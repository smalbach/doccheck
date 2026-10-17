import { CubeIcon, FileIcon, HomeIcon } from '@radix-ui/react-icons';
import type { ThreadSummary } from '../../api/types';
import { LINK_PLACEHOLDER } from '../../api/portal';
import { Avatar } from '../../components/ui/Avatar';
import { useI18n } from '../../i18n/useI18n';
import { cx } from '../../lib/cx';
import { shortMailDate } from './mailDates';

export interface ThreadListProps {
  threads: readonly ThreadSummary[];
  label: string;
  /** Hide the shipment chip (inside a shipment's page). */
  hideShipment?: boolean;
  /** Hide the company chip (inside a company's page). */
  hideParty?: boolean;
  compact?: boolean;
}

/**
 * Conversations as an email list, newest activity first: who, subject and the start of the latest
 * message, what it is about (shipment, company) and what needs a look. A row opens the conversation.
 */
export function ThreadList({ threads, label, hideShipment, hideParty, compact }: ThreadListProps) {
  const { t, locale, formatDateTime } = useI18n();
  return (
    <ul className={cx('mail-list', compact && 'mail-list-compact')} aria-label={label}>
      {threads.map((x) => {
        const who = x.partyName ?? x.counterpart ?? '—';
        const unread = x.unread > 0;
        const snippet = x.snippet?.split(LINK_PLACEHOLDER).join(t('portal.linkInText'));
        return (
          <li key={x.id} className={cx('mail-row', unread && 'is-unread', x.status === 'closed' && 'is-closed')}>
            {!compact && <Avatar name={x.partyName ?? ''} email={x.counterpart} />}
            <span className="mail-row-from">
              {x.lastDirection === 'out' && <span className="muted">{t('mail.you')} → </span>}
              <span className="mail-row-who">{who}</span>
              {x.messages > 1 && <span className="mail-row-count">{x.messages}</span>}
            </span>
            <span className="mail-row-main">
              <a href={`#/app/inbox/${x.id}`} className="mail-row-link">
                <span className="mail-row-subject">{x.subject}</span>
              </a>
              {snippet && <span className="mail-row-snippet"> — {snippet}</span>}
            </span>
            <span className="mail-row-chips">
              <span className={cx('mail-chip', `mail-chip-${x.kind}`)}>{t(`mail.kind.${x.kind}`)}</span>
              {!hideShipment && x.shipmentId && (
                <a className="mail-chip mail-chip-link" href={`#/app/s/${x.shipmentId}`} title={t('mail.shipment', { reference: x.shipmentReference ?? x.shipmentId.slice(0, 8) })}>
                  <CubeIcon aria-hidden /> {x.shipmentReference ?? x.shipmentId.slice(0, 8)}
                </a>
              )}
              {!hideParty && x.partyId && x.partyName && (
                <a className="mail-chip mail-chip-link" href={`#/app/companies/${x.partyId}`}>
                  <HomeIcon aria-hidden /> {x.partyName}
                </a>
              )}
              {x.status === 'awaiting' && !x.overdue && <span className="mail-chip mail-chip-waiting">{t('mail.status.awaiting')}</span>}
              {x.status === 'replied' && <span className="mail-chip mail-chip-ok">{t('mail.status.replied')}</span>}
              {x.status === 'closed' && <span className="mail-chip">{t('mail.status.closed')}</span>}
              {x.overdue && <span className="mail-chip mail-chip-warn">{t('mail.overdue')}</span>}
              {x.failed && <span className="mail-chip mail-chip-error">{t('mail.failedTag')}</span>}
            </span>
            <span className="mail-row-end">
              {x.hasAttachments && (
                <span title={t('mail.withAttachments')} className="mail-row-clip">
                  <FileIcon aria-label={t('mail.withAttachments')} />
                </span>
              )}
              <time dateTime={x.lastMessageAt} title={formatDateTime(x.lastMessageAt)}>
                {shortMailDate(x.lastMessageAt, locale)}
              </time>
              {unread && <span className="visually-hidden">{t('mail.unread', { count: x.unread })}</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
