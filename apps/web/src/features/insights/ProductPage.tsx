import { useState } from 'react';
import { api } from '../../api/client';
import type { PricePoint, ProductDetail } from '../../api/types';
import { BackLink } from '../../components/layout/BackLink';
import { LoadingCard } from '../../components/layout/LoadingCard';
import { Card } from '../../components/ui/Card';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { PageHeader } from '../../components/ui/PageHeader';
import { ToggleChips } from '../../components/ui/ToggleChips';
import { useDataDestination } from '../../hooks/useDataDestination';
import { useQuery } from '../../hooks/useQuery';
import { useI18n } from '../../i18n/useI18n';
import { formatHsCode } from '../../lib/formatHsCode';
import { StatTile } from '../dashboard/StatTile';
import { MoneyList } from './MoneyList';
import { PriceChart } from './PriceChart';

type Seller = ProductDetail['bySeller'][number];

/** One product: its prices over time and per seller, how the invoices write it, and every purchase. */
export function ProductPage({ id }: { id: string }) {
  const { t, formatNumber, formatMoney } = useI18n();
  const [filter] = useDataDestination();
  const destination = filter === 'any' ? undefined : filter;
  const { data, error } = useQuery(`product:${id}:${destination ?? ''}`, () => api.insightsProduct(id, destination));
  const [picked, setPicked] = useState<string>();
  const back = <BackLink href="#/app/products" label={t('insights.product.back')} />;
  if (!data) {
    return (
      <div className="page">
        {back}
        <LoadingCard error={error} />
      </div>
    );
  }

  const currency = picked ?? data.prices[0]?.currency;
  const stats = data.prices.find((p) => p.currency === currency);
  const points = data.history
    .filter((h) => h.unitPrice?.currency === currency)
    .map((h) => ({ price: Number(h.unitPrice!.amount), date: h.invoiceDate, label: [h.invoiceDate, h.invoiceNumber, h.seller].filter(Boolean).join(' · ') }));
  const quantities = (q: readonly { key: string; amount: string }[]) => q.map((x) => `${formatNumber(x.amount)} ${x.key}`).join(' · ') || '—';

  const sellerColumns: Column<Seller>[] = [
    {
      key: 'seller',
      header: t('insights.products.detail.seller'),
      cell: (s) => (
        <div className="cell-wide">
          <a href={`#/app/companies/${s.id}`}>{s.name}</a>
          {s.country && <span className="muted small block">{s.country}</span>}
        </div>
      ),
    },
    { key: 'lines', header: t('insights.products.columns.lines'), cell: (s) => formatNumber(s.lines), numeric: true },
    { key: 'quantity', header: t('insights.products.columns.quantity'), cell: (s) => <span className="nowrap">{quantities(s.quantities)}</span>, numeric: true, secondary: true },
    {
      key: 'avg',
      header: t('insights.products.columns.avgPrice'),
      cell: (s) => s.prices.map((p) => <span key={p.currency} className="nowrap block">{formatMoney(p.avg, p.currency)}</span>),
      numeric: true,
    },
    {
      key: 'last',
      header: t('insights.products.columns.lastPrice'),
      cell: (s) => (
        <>
          {s.prices.map((p) => (
            <span key={p.currency} className="nowrap block">{formatMoney(p.last, p.currency)}</span>
          ))}
          {s.lastDate && <span className="muted small block nowrap">{s.lastDate}</span>}
        </>
      ),
      numeric: true,
      secondary: true,
    },
  ];
  const historyColumns: Column<PricePoint>[] = [
    { key: 'date', header: t('insights.products.detail.date'), cell: (h) => <span className="nowrap">{h.invoiceDate ?? '—'}</span> },
    {
      key: 'shipment',
      header: t('insights.columns.shipment'),
      cell: (h) => (
        <>
          <a href={`#/app/s/${h.shipmentId}`} className="nowrap">{h.reference ?? h.shipmentId.slice(0, 8)}</a>
          {h.invoiceNumber && <span className="muted small block">{h.invoiceNumber}</span>}
        </>
      ),
    },
    {
      key: 'seller',
      header: t('insights.products.detail.seller'),
      cell: (h) => (h.sellerId ? <a href={`#/app/companies/${h.sellerId}`}>{h.seller ?? '—'}</a> : (h.seller ?? '—')),
      secondary: true,
    },
    { key: 'quantity', header: t('insights.columns.quantity'), cell: (h) => <span className="nowrap">{h.quantity ? `${formatNumber(h.quantity.value)} ${h.quantity.unit}` : '—'}</span>, numeric: true },
    { key: 'unitPrice', header: t('insights.columns.unitPrice'), cell: (h) => <span className="nowrap">{h.unitPrice ? formatMoney(h.unitPrice.amount, h.unitPrice.currency) : '—'}</span>, numeric: true },
    { key: 'total', header: t('insights.columns.total'), cell: (h) => <span className="nowrap">{h.lineTotal ? formatMoney(h.lineTotal.amount, h.lineTotal.currency) : '—'}</span>, numeric: true, secondary: true },
  ];
  const variants = [
    { title: t('insights.product.descriptions'), rows: data.descriptions.map((d) => ({ label: d.text, lines: d.lines })) },
    { title: t('insights.product.hsCodes'), rows: data.hsCodes.map((d) => ({ label: formatHsCode(d.code), lines: d.lines, mono: true })) },
    { title: t('insights.product.origins'), rows: data.origins.map((d) => ({ label: d.country, lines: d.lines })) },
  ].filter((v) => v.rows.length > 0);

  return (
    <div className="page">
      <PageHeader eyebrow={back} title={data.description} description={[data.sku, data.hsCode && formatHsCode(data.hsCode), data.countryOfOrigin].filter(Boolean).join(' · ')} />
      <div className="stat-tiles">
        <StatTile label={t('insights.products.columns.lines')} value={data.lines} hint={t('insights.products.detail.shipments', { count: data.shipments })} />
        <StatTile label={t('insights.products.columns.quantity')} value={<span className="stat-tile-compact">{quantities(data.quantities)}</span>} />
        <StatTile label={t('insights.parties.columns.value')} value={<span className="stat-tile-compact"><MoneyList totals={data.values} stacked /></span>} />
        <StatTile label={t('insights.products.columns.sellers')} value={data.sellers} hint={data.lastSeller && `${t('insights.products.detail.lastSeller')}: ${data.lastSeller}`} />
      </div>

      <Card title={t('insights.products.detail.prices')} aside={data.prices.length > 1 && currency ? <ToggleChips value={currency} options={data.prices.map((p) => ({ value: p.currency, label: p.currency }))} onValueChange={setPicked} ariaLabel={t('insights.products.detail.prices')} /> : undefined}>
        {!stats || !currency ? (
          <p className="muted">{t('insights.products.detail.noPrices')}</p>
        ) : (
          <div className="entity">
            <dl className="price-stats">
              {(['min', 'avg', 'max', 'last'] as const).map((k) => (
                <div key={k}>
                  <dt>{t(`insights.products.detail.${k}`)}</dt>
                  <dd title={k === 'avg' ? t('insights.products.avgHint') : undefined}>{formatMoney(stats[k], currency)}</dd>
                </div>
              ))}
            </dl>
            <PriceChart points={points} currency={currency} />
          </div>
        )}
      </Card>

      <div className="entity-columns">
        <Card title={t('insights.product.bySeller')}>
          <DataTable compact columns={sellerColumns} rows={data.bySeller} rowKey={(s) => s.id} caption={t('insights.product.bySeller')} />
        </Card>
        {variants.length > 0 && (
          <Card title={t('insights.product.variants')}>
            {variants.map((v) => (
              <div key={v.title} className="variant-group">
                <h3 className="entity-heading">{v.title}</h3>
                <ul className="variant-list">
                  {v.rows.map((r) => (
                    <li key={r.label}>
                      <span className={'mono' in r && r.mono ? 'mono' : undefined}>{r.label}</span>
                      <span className="muted small">{t('insights.parties.detail.lines', { count: r.lines })}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </Card>
        )}
      </div>

      <Card title={t('insights.products.detail.history')}>
        <DataTable compact columns={historyColumns} rows={data.history} rowKey={(h, i) => `${h.documentId}:${i}`} caption={t('insights.products.detail.history')} />
      </Card>
    </div>
  );
}
