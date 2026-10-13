import { api } from '../../api/client';
import type { Destination, PartyDetail } from '../../api/types';
import { LoadingCard } from '../../components/layout/LoadingCard';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Sheet } from '../../components/ui/Sheet';
import { useQuery } from '../../hooks/useQuery';
import { useI18n } from '../../i18n/useI18n';
import { StatTile } from '../dashboard/StatTile';
import { MoneyList } from './MoneyList';
import { RoleTags } from './RoleTags';

export interface PartySheetProps {
  id: string;
  destination?: Destination;
  onClose: () => void;
  onOpenProduct: (id: string) => void;
}

type Product = PartyDetail['topProducts'][number];
type Shipment = PartyDetail['recentShipments'][number];

/** One company: its figures, the products on its invoices and its shipments. */
export function PartySheet({ id, destination, onClose, onOpenProduct }: PartySheetProps) {
  const { t, formatNumber, formatMoney } = useI18n();
  const { data, error } = useQuery(`party:${id}:${destination ?? ''}`, () => api.insightsParty(id, destination));

  const productColumns: Column<Product>[] = [
    {
      key: 'product',
      header: t('insights.products.columns.product'),
      cell: (p) => (
        <div className="cell-wide">
          {p.description}
          {p.sku && <span className="muted small block">{p.sku}</span>}
        </div>
      ),
    },
    { key: 'lines', header: t('insights.products.columns.lines'), cell: (p) => formatNumber(p.lines), numeric: true },
    { key: 'quantity', header: t('insights.products.columns.quantity'), cell: (p) => <span className="nowrap">{p.quantities.map((q) => `${formatNumber(q.amount)} ${q.key}`).join(' · ') || '—'}</span>, numeric: true },
    { key: 'value', header: t('insights.parties.columns.value'), cell: (p) => <MoneyList totals={p.values} stacked />, numeric: true },
  ];
  const shipmentColumns: Column<Shipment>[] = [
    {
      key: 'shipment',
      header: t('insights.columns.shipment'),
      cell: (s) => (
        <>
          <a href={`#/app/s/${s.shipmentId}`} className="nowrap">{s.reference ?? s.shipmentId.slice(0, 8)}</a>
          <span className="muted small block nowrap">{[s.destination, s.invoiceNumber, s.invoiceDate].filter(Boolean).join(' · ')}</span>
        </>
      ),
    },
    { key: 'roles', header: t('insights.parties.columns.roles'), cell: (s) => <RoleTags roles={s.roles} /> },
    { key: 'value', header: t('insights.columns.value'), cell: (s) => <span className="nowrap">{s.invoiceTotal ? formatMoney(s.invoiceTotal.amount, s.invoiceTotal.currency) : '—'}</span>, numeric: true },
  ];

  return (
    <Sheet title={data?.name ?? t('common.loading')} onClose={onClose}>
      <div className="sheet-body">
        {!data ? (
          <LoadingCard error={error} />
        ) : (
          <div className="entity">
            <dl className="entity-facts">
              {data.country && (
                <div>
                  <dt>{t('insights.parties.detail.country')}</dt>
                  <dd>{data.country}</dd>
                </div>
              )}
              {data.taxId && (
                <div>
                  <dt>{t('insights.parties.detail.taxId')}</dt>
                  <dd className="mono">{data.taxId}</dd>
                </div>
              )}
              <div>
                <dt>{t('insights.parties.columns.roles')}</dt>
                <dd>
                  <RoleTags roles={data.roles} />
                </dd>
              </div>
              {data.names.length > 1 && (
                <div>
                  <dt>{t('insights.parties.detail.spelledAs')}</dt>
                  <dd>{data.names.join(' · ')}</dd>
                </div>
              )}
            </dl>
            <div className="stat-tiles">
              <StatTile label={t('insights.parties.columns.shipments')} value={data.shipments} hint={t('insights.parties.detail.lines', { count: data.lines })} />
              <StatTile label={t('insights.parties.columns.invoices')} value={data.invoices} hint={data.firstDate ? `${data.firstDate} → ${data.lastDate}` : undefined} />
              <StatTile label={t('insights.parties.columns.value')} value={<span className="stat-tile-compact"><MoneyList totals={data.values} stacked /></span>} />
            </div>
            <h3 className="entity-heading">{t('insights.parties.detail.products')}</h3>
            {data.topProducts.length === 0 ? (
              <p className="muted">{t('insights.parties.detail.noProducts')}</p>
            ) : (
              <DataTable compact columns={productColumns} rows={data.topProducts} rowKey={(p) => p.id} onRowClick={(p) => onOpenProduct(p.id)} caption={t('insights.parties.detail.products')} />
            )}
            <h3 className="entity-heading">{t('insights.parties.detail.shipments')}</h3>
            <DataTable compact columns={shipmentColumns} rows={data.recentShipments} rowKey={(s) => s.shipmentId} caption={t('insights.parties.detail.shipments')} />
          </div>
        )}
      </div>
    </Sheet>
  );
}
