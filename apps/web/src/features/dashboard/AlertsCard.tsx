import { api } from '../../api/client';
import type { Alert } from '../../api/types';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { useQuery } from '../../hooks/useQuery';
import { useI18n } from '../../i18n/useI18n';
import { AlertItem } from './AlertItem';

const alertKey = (a: Alert) => `${a.kind}:${a.shipmentId}:${'documentId' in a ? a.documentId : ''}`;

/** What needs a look across the user's shipments, newest first, each linking to its shipment. */
export function AlertsCard() {
  const { t } = useI18n();
  const { data, error } = useQuery('alerts', api.alerts);

  let body;
  if (error) {
    body = (
      <p className="error" role="alert">
        {error}
      </p>
    );
  } else if (!data) {
    body = (
      <p className="muted" role="status">
        {t('common.loading')}
      </p>
    );
  } else if (data.items.length === 0) {
    body = <EmptyState title={t('dashboard.alerts.emptyTitle')}>{t('dashboard.alerts.emptyText')}</EmptyState>;
  } else {
    const hidden = data.total - data.items.length;
    body = (
      <>
        <ul className="alert-list">
          {data.items.map((a) => (
            <AlertItem key={alertKey(a)} alert={a} />
          ))}
        </ul>
        {hidden > 0 && <p className="muted small">{t('dashboard.alerts.more', { count: hidden })}</p>}
      </>
    );
  }
  return (
    <Card title={t('dashboard.alerts.title')} aria-busy={!data && !error}>
      {body}
    </Card>
  );
}
