import { api } from '../../api/client';
import { Card } from '../../components/ui/Card';
import { useQuery } from '../../hooks/useQuery';
import { useI18n } from '../../i18n/useI18n';

/** How this server sends and receives email (admin system page). */
export function MailServerCard() {
  const { t, formatDateTime } = useI18n();
  const { data: s } = useQuery('mail-status', () => api.mailStatus());
  if (!s) return null;
  const onOff = (on: boolean) => t(on ? 'mail.server.on' : 'mail.server.off');
  return (
    <Card title={t('mail.server.title')}>
      <dl className="entity-facts">
        <div>
          <dt>{t('mail.server.sending')}</dt>
          <dd>{s.sending === 'smtp' ? t('mail.server.smtp') : t('mail.server.log')}</dd>
        </div>
        <div>
          <dt>{t('mail.server.from')}</dt>
          <dd className="mono small">{s.from}</dd>
        </div>
        <div>
          <dt>{t('mail.server.replyTo')}</dt>
          <dd className="mono small">{s.replyTo}</dd>
        </div>
        <div>
          <dt>{t('mail.server.receiving')}</dt>
          <dd>
            {t('mail.server.imap')}: {onOff(s.receiving.imap)} · {t('mail.server.webhook')}: {onOff(s.receiving.webhook)}
            {s.receiving.mailboxes.map((m) => (
              <span key={m.mailbox} className="block small">
                {t('mail.server.polled', { mailbox: m.mailbox, date: formatDateTime(m.polledAt) })}
                {m.error && <span className="error block">{m.error}</span>}
              </span>
            ))}
          </dd>
        </div>
        <div>
          <dt>{t('mail.server.queueLabel')}</dt>
          <dd>
            {t('mail.server.queue', { queued: s.queue.queued, failed: s.queue.failed })}
            <span className="block small muted">{t('mail.server.followUp', { count: s.followUpDays })}</span>
          </dd>
        </div>
      </dl>
    </Card>
  );
}
