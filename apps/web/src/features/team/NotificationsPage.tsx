import { useState } from 'react';
import { teamApi } from '../../api/teamClient';
import type { AppNotification } from '../../api/teamTypes';
import { LoadingCard } from '../../components/layout/LoadingCard';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { PageHeader } from '../../components/ui/PageHeader';
import { Tag } from '../../components/ui/Tag';
import { useQuery } from '../../hooks/useQuery';
import { useI18n } from '../../i18n/useI18n';
import type { MessageKey } from '../../i18n/keys';
import { refreshNotificationCount } from './useNotificationCount';

const TEXT: Record<AppNotification['kind'], MessageKey> = {
  mention: 'team.notifications.mention',
  assignment: 'team.notifications.assignment',
  approval_requested: 'team.notifications.approvalRequested',
  approval_decided: 'team.notifications.approvalDecided',
};

/** Mentions, assignments and approvals across the user's organizations, newest first. */
export function NotificationsPage() {
  const { t, formatDateTime } = useI18n();
  const [version, setVersion] = useState(0);
  const { data, error } = useQuery(`notifications:${version}`, () => teamApi.notifications());
  if (!data) return <LoadingCard error={error} />;

  const read = (ids: string[] | 'all') =>
    void teamApi.readNotifications(ids).then(() => {
      setVersion((v) => v + 1);
      refreshNotificationCount();
    });
  return (
    <div className="page page-narrow">
      <PageHeader
        title={t('team.notifications.title')}
        description={t('team.notifications.text')}
        actions={data.unread > 0 && <Button onClick={() => read('all')}>{t('team.notifications.readAll')}</Button>}
      />
      <Card>
        {data.items.length === 0 ? (
          <EmptyState title={t('team.notifications.empty')} />
        ) : (
          <ul className="notification-list">
            {data.items.map((n) => (
              <li key={n.id} className={n.read ? 'notification' : 'notification notification-unread'}>
                <div className="notification-text">
                  <p>
                    {!n.read && <Tag tone="accent">{t('team.notifications.new')}</Tag>}{' '}
                    {t(TEXT[n.kind], {
                      actor: n.actorName ?? t('review.someone'),
                      shipment: n.reference ?? n.shipmentId?.slice(0, 8) ?? '',
                      decision: n.detail.decision === 'rejected' ? t('team.approvals.rejected') : t('team.approvals.approved'),
                    })}
                  </p>
                  {n.detail.excerpt && <blockquote className="notification-quote">{n.detail.excerpt}</blockquote>}
                  <p className="muted small">
                    {formatDateTime(n.createdAt)}
                    {n.orgName && ` · ${n.orgName}`}
                  </p>
                </div>
                <div className="notification-actions">
                  {n.shipmentId && (
                    <Button asChild size="sm">
                      <a href={`#/app/s/${n.shipmentId}`} onClick={() => !n.read && read([n.id])}>
                        {t('team.notifications.open')}
                      </a>
                    </Button>
                  )}
                  {!n.read && (
                    <Button size="sm" variant="ghost" onClick={() => read([n.id])}>
                      {t('team.notifications.markRead')}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
