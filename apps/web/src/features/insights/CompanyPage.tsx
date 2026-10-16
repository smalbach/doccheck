import { useState } from 'react';
import { api } from '../../api/client';
import type { PartyDetail } from '../../api/types';
import { BackLink } from '../../components/layout/BackLink';
import { LoadingCard } from '../../components/layout/LoadingCard';
import { Card } from '../../components/ui/Card';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { PageHeader } from '../../components/ui/PageHeader';
import { INITIAL_GOODS_FILTERS } from '../../constants/insights';
import { useDataDestination } from '../../hooks/useDataDestination';
import { useDemo } from '../../hooks/useDemo';
import { useQuery } from '../../hooks/useQuery';
import { useI18n } from '../../i18n/useI18n';
import { StatTile } from '../dashboard/StatTile';
import { ComposeDialog } from '../mail/ComposeDialog';
import { ThreadsCard } from '../mail/ThreadsCard';
import { PreShipmentCard } from '../portal/PreShipmentCard';
import { AddressList } from './AddressList';
import { GoodsPanel } from './GoodsPanel';
import { MoneyList } from './MoneyList';
import { RoleTags } from './RoleTags';

type Product = PartyDetail['topProducts'][number];
type Shipment = PartyDetail['recentShipments'][number];
type Related = PartyDetail['related'][number];

/** Everything the documents say about one company: addresses, partners, products, shipments and goods. */
export function CompanyPage({ id }: { id: string }) {
  const { t, formatNumber, formatMoney } = useI18n();
  const demo = useDemo();
  const [filter] = useDataDestination();
  const destination = filter === 'any' ? undefined : filter;
  const { data, error } = useQuery(`party:${id}:${destination ?? ''}`, () => api.insightsParty(id, destination));
  const [goodsFilters, setGoodsFilters] = useState(INITIAL_GOODS_FILTERS);
  const back = <BackLink href="#/app/companies" label={t('insights.company.back')} />;
  if (!data) {
    return (
      <div className="page">
        {back}
        <LoadingCard error={error} />
      </div>
    );
  }

  const productColumns: Column<Product>[] = [
    {
      key: 'product',
      header: t('insights.products.columns.product'),
      cell: (p) => (
        <div className="cell-wide">
          <a href={`#/app/products/${p.id}`}>{p.description}</a>
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
  const relatedColumns: Column<Related>[] = [
    {
      key: 'company',
      header: t('insights.parties.columns.company'),
      cell: (r) => (
        <div className="cell-wide">
          <a href={`#/app/companies/${r.id}`}>{r.name}</a>
          {r.country && <span className="muted small block">{r.country}</span>}
        </div>
      ),
    },
    { key: 'roles', header: t('insights.parties.columns.roles'), cell: (r) => <RoleTags roles={r.roles} /> },
    { key: 'shipments', header: t('insights.parties.columns.shipments'), cell: (r) => formatNumber(r.shipments), numeric: true },
  ];

  return (
    <div className="page">
      <PageHeader eyebrow={back} title={data.name} description={<RoleTags roles={data.roles} />} />
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
        <StatTile label={t('insights.parties.detail.products')} value={data.products} />
      </div>
      <div className="entity-columns">
        <Card title={t('insights.company.addresses')}>
          {data.addresses.length === 0 ? <p className="muted">{t('insights.company.noAddresses')}</p> : <AddressList addresses={data.addresses} />}
        </Card>
        <Card title={t('insights.company.related')}>
          {data.related.length === 0 ? (
            <p className="muted">{t('insights.company.noRelated')}</p>
          ) : (
            <DataTable compact columns={relatedColumns} rows={data.related} rowKey={(r) => r.id} caption={t('insights.company.related')} />
          )}
        </Card>
      </div>
      <Card title={t('insights.parties.detail.products')}>
        {data.topProducts.length === 0 ? (
          <p className="muted">{t('insights.parties.detail.noProducts')}</p>
        ) : (
          <DataTable compact columns={productColumns} rows={data.topProducts} rowKey={(p) => p.id} caption={t('insights.parties.detail.products')} />
        )}
      </Card>
      <Card title={t('insights.parties.detail.shipments')}>
        <DataTable compact columns={shipmentColumns} rows={data.recentShipments} rowKey={(s) => s.shipmentId} caption={t('insights.parties.detail.shipments')} />
      </Card>
      <ThreadsCard partyId={id} actions={!demo && <ComposeDialog mode="message" partyId={id} />} />
      <PreShipmentCard partyId={id} partyName={data.name} readOnly={demo} />
      {data.lines > 0 && (
        <Card title={t('insights.company.goods')}>
          <GoodsPanel destination={destination} filters={goodsFilters} onFiltersChange={setGoodsFilters} scope={{ party: id }} />
        </Card>
      )}
    </div>
  );
}
