import { teamApi } from '../../api/teamClient';
import type { ReviewRequest } from '../../api/teamTypes';
import { LoadingCard } from '../../components/layout/LoadingCard';
import { Card } from '../../components/ui/Card';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { EmptyState } from '../../components/ui/EmptyState';
import { PageHeader } from '../../components/ui/PageHeader';
import { useQuery } from '../../hooks/useQuery';
import { useI18n } from '../../i18n/useI18n';

/** Accepted risks and false positives waiting for a second person, across the organization. */
export function ApprovalsPage() {
  const { t, formatDateTime } = useI18n();
  const { data, error } = useQuery('approvals', teamApi.approvals);
  if (!data) return <LoadingCard error={error} />;
  const columns: Column<ReviewRequest>[] = [
    { key: 'shipment', header: t('team.approvals.shipment'), cell: (r) => <a href={`#/app/s/${r.shipmentId}`}>{r.reference ?? r.shipmentId?.slice(0, 8)}</a> },
    { key: 'rule', header: t('team.approvals.rule'), cell: (r) => <code className="mono">{r.ruleId}</code> },
    { key: 'status', header: t('team.approvals.asked'), cell: (r) => t(`review.status.${r.status}`) },
    { key: 'note', header: t('team.approvals.note'), cell: (r) => r.note },
    { key: 'by', header: t('team.approvals.by'), cell: (r) => r.requestedBy?.name ?? '—', secondary: true },
    { key: 'at', header: t('team.approvals.at'), cell: (r) => <span className="muted">{formatDateTime(r.createdAt)}</span>, secondary: true },
  ];
  return (
    <div className="page">
      <PageHeader title={t('team.approvals.title')} description={t('team.approvals.text')} />
      <Card>
        {data.length === 0 ? <EmptyState title={t('team.approvals.empty')} /> : <DataTable columns={columns} rows={data} rowKey={(r) => r.id} caption={t('team.approvals.title')} />}
      </Card>
    </div>
  );
}
