import type { MailMessage } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { Tag } from '../../components/ui/Tag';
import { useI18n } from '../../i18n/useI18n';
import { cx } from '../../lib/cx';
import { AttachmentList } from './AttachmentList';
import { LINK_PLACEHOLDER } from '../../api/portal';

export interface MessageItemProps {
  message: MailMessage;
  shipmentId?: string;
  readOnly: boolean;
  onRetry: (id: string) => void;
  onAdded: (file: string) => void;
  onError: (message: string) => void;
}

/** One email of a conversation: who, when, its delivery state, the text and the attachments. */
export function MessageItem({ message: m, shipmentId, readOnly, onRetry, onAdded, onError }: MessageItemProps) {
  const { t, formatDateTime } = useI18n();
  const out = m.direction === 'out';
  const at = m.sentAt ?? m.receivedAt ?? m.createdAt;
  return (
    <article className={cx('mail-message', out ? 'mail-out' : 'mail-in', !out && !m.readAt && 'mail-unread')} aria-label={`${out ? (m.userName ?? t('mail.you')) : m.from} · ${formatDateTime(at)}`}>
      <header className="mail-message-head">
        <strong>{out ? (m.userName ?? t('mail.you')) : m.from}</strong>
        <Tag tone={m.status === 'failed' ? 'neutral' : out ? 'ok' : 'accent'}>{t(`mail.messageStatus.${m.status}`)}</Tag>
        {m.viaPortal && <Tag>{t('portal.viaPortal')}</Tag>}
        {m.senderUnverified && (
          <span title={t('mail.unverifiedHint')}>
            <Tag>{t('mail.unverified')}</Tag>
          </span>
        )}
        <time className="muted small" dateTime={at}>
          {formatDateTime(at)}
        </time>
      </header>
      {m.to.length > 0 && (
        <p className="muted small mail-recipients">
          {t('mail.toLine', { to: m.to.join(', ') })}
          {m.cc.length > 0 && ` · ${t('mail.ccLine', { cc: m.cc.join(', ') })}`}
        </p>
      )}
      {m.status === 'failed' && (
        <div className="mail-error" role="alert">
          <span className="small">
            {m.error} ({t('mail.attempts', { count: m.attempts })})
          </span>
          {!readOnly && (
            <Button size="sm" onClick={() => onRetry(m.id)}>
              {t('mail.retry')}
            </Button>
          )}
        </div>
      )}
      {m.transport === 'log' && <p className="muted small mail-dev-note">{t('mail.captured')}</p>}
      {/* The portal link is put in only when the email is sent: here it is a marker. */}
      {m.text && <div className="mail-body">{m.text.split(LINK_PLACEHOLDER).join(t('portal.linkInText'))}</div>}
      <AttachmentList attachments={m.attachments} shipmentId={shipmentId} readOnly={readOnly} onAdded={onAdded} onError={onError} />
    </article>
  );
}
