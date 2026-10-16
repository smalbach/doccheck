import { portalApi, type PortalRequest } from '../../api/portal';
import { Banner } from '../../components/ui/Banner';
import { Card } from '../../components/ui/Card';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { useQuery } from '../../hooks/useQuery';
import { useI18n } from '../../i18n/useI18n';
import { PortalStatusTag } from './PortalStatusTag';
import { PreShipmentDialog } from './PreShipmentDialog';
import { useOrg } from '../team/useOrg';

/** Pre-shipment checks and where each supplier stands, with the button to start one (for one company with `partyId`). */
export function PreShipmentCard({ partyId, partyName, readOnly: demo }: { partyId?: string; partyName?: string; readOnly: boolean }) {
  const { t, formatDateTime } = useI18n();
  const { can } = useOrg();
  const readOnly = demo || !can('shipment.write');
  const { data, error } = useQuery(`portal:pre:${partyId ?? ''}`, () => portalApi.requests({ kind: 'pre_shipment', partyId, limit: 20 }));
  const columns: Column<PortalRequest>[] = [
    ...(partyId ? [] : [{ key: 'supplier', header: t('portal.columns.supplier'), cell: (r: PortalRequest) => r.supplier ?? '—' }]),
    {
      key: 'reference',
      header: t('portal.columns.reference'),
      cell: (r) => (r.threadId ? <a href={`#/app/inbox/${r.threadId}`}>{r.reference ?? r.shipmentReference}</a> : (r.reference ?? r.shipmentReference)),
    },
    {
      key: 'status',
      header: t('portal.columns.status'),
      cell: (r) => (
        <span className="portal-status-cell">
          <PortalStatusTag status={r.status} importer />
          {r.status === 'open' && <span className="muted small">{t('portal.openFindings', { count: r.open })}</span>}
        </span>
      ),
    },
    { key: 'activity', header: t('portal.columns.activity'), cell: (r) => formatDateTime(r.lastActivityAt ?? r.createdAt), secondary: true },
  ];
  return (
    <Card title={t('portal.preTitle')} aside={!readOnly && <PreShipmentDialog partyId={partyId} partyName={partyName} />}>
      <p className="muted small">{t('portal.preText')}</p>
      {error && <Banner tone="error">{error}</Banner>}
      {data && (data.items.length === 0 ? <p className="muted">{t('portal.preNone')}</p> : <DataTable columns={columns} rows={data.items} rowKey={(r) => r.id} compact caption={t('portal.preTitle')} />)}
    </Card>
  );
}
