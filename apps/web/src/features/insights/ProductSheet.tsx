import { useState } from 'react';
import { api } from '../../api/client';
import type { Destination, PricePoint } from '../../api/types';
import { LoadingCard } from '../../components/layout/LoadingCard';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Sheet } from '../../components/ui/Sheet';
import { ToggleChips } from '../../components/ui/ToggleChips';
import { useQuery } from '../../hooks/useQuery';
import { useI18n } from '../../i18n/useI18n';
import { formatHsCode } from '../../lib/formatHsCode';
import { StatTile } from '../dashboard/StatTile';
import { MoneyList } from './MoneyList';
import { PriceChart } from './PriceChart';

export interface ProductSheetProps {
  id: string;
  destination?: Destination;
  onClose: () => void;
  onOpenParty: (id: string) => void;
}

/** One product: price statistics per currency, its price over time and every purchase. */
export function ProductSheet({ id, destination, onClose, onOpenParty }: ProductSheetProps) {
  const { t, formatNumber, formatMoney } = useI18n();
  const { data, error } = useQuery(`product:${id}:${destination ?? ''}`, () => api.insightsProduct(id, destination));
  const [picked, setPicked] = useState<string>();
  const currency = picked ?? data?.prices[0]?.currency;
  const stats = data?.prices.find((p) => p.currency === currency);
  const points = (data?.history ?? [])
    .filter((h) => h.unitPrice?.currency === currency)
    .map((h) => ({ price: Number(h.unitPrice!.amount), date: h.invoiceDate, label: [h.invoiceDate, h.invoiceNumber, h.seller].filter(Boolean).join(' · ') }));

  const columns: Column<PricePoint>[] = [
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
      cell: (h) =>
        h.sellerId ? (
          <button type="button" className="btn-link" onClick={() => onOpenParty(h.sellerId!)}>
            {h.seller ?? '—'}
          </button>
        ) : (
          (h.seller ?? '—')
        ),
      secondary: true,
    },
    { key: 'quantity', header: t('insights.columns.quantity'), cell: (h) => <span className="nowrap">{h.quantity ? `${formatNumber(h.quantity.value)} ${h.quantity.unit}` : '—'}</span>, numeric: true },
    { key: 'unitPrice', header: t('insights.columns.unitPrice'), cell: (h) => <span className="nowrap">{h.unitPrice ? formatMoney(h.unitPrice.amount, h.unitPrice.currency) : '—'}</span>, numeric: true },
    { key: 'total', header: t('insights.columns.total'), cell: (h) => <span className="nowrap">{h.lineTotal ? formatMoney(h.lineTotal.amount, h.lineTotal.currency) : '—'}</span>, numeric: true, secondary: true },
  ];

  return (
    <Sheet title={data?.description ?? t('common.loading')} onClose={onClose}>
      <div className="sheet-body">
        {!data ? (
          <LoadingCard error={error} />
        ) : (
          <div className="entity">
            <dl className="entity-facts">
              {data.sku && (
                <div>
                  <dt>SKU</dt>
                  <dd className="mono">{data.sku}</dd>
                </div>
              )}
              {data.hsCode && (
                <div>
                  <dt>{t('insights.columns.hs')}</dt>
                  <dd className="mono">{formatHsCode(data.hsCode)}</dd>
                </div>
              )}
              {data.countryOfOrigin && (
                <div>
                  <dt>{t('insights.columns.origin')}</dt>
                  <dd>{data.countryOfOrigin}</dd>
                </div>
              )}
              {data.lastSeller && (
                <div>
                  <dt>{t('insights.products.detail.lastSeller')}</dt>
                  <dd>{data.lastSeller}</dd>
                </div>
              )}
            </dl>
            <div className="stat-tiles">
              <StatTile label={t('insights.products.columns.lines')} value={data.lines} hint={t('insights.products.detail.shipments', { count: data.shipments })} />
              <StatTile label={t('insights.products.columns.quantity')} value={<span className="stat-tile-compact">{data.quantities.map((q) => `${formatNumber(q.amount)} ${q.key}`).join(' · ') || '—'}</span>} />
              <StatTile label={t('insights.parties.columns.value')} value={<span className="stat-tile-compact"><MoneyList totals={data.values} stacked /></span>} />
            </div>

            <h3 className="entity-heading">{t('insights.products.detail.prices')}</h3>
            {!stats || !currency ? (
              <p className="muted">{t('insights.products.detail.noPrices')}</p>
            ) : (
              <>
                {data.prices.length > 1 && (
                  <ToggleChips value={currency} options={data.prices.map((p) => ({ value: p.currency, label: p.currency }))} onValueChange={setPicked} ariaLabel={t('insights.products.detail.prices')} />
                )}
                <dl className="price-stats">
                  {(['min', 'avg', 'max', 'last'] as const).map((k) => (
                    <div key={k}>
                      <dt>{t(`insights.products.detail.${k}`)}</dt>
                      <dd title={k === 'avg' ? t('insights.products.avgHint') : undefined}>{formatMoney(stats[k], currency)}</dd>
                    </div>
                  ))}
                </dl>
                <PriceChart points={points} currency={currency} />
              </>
            )}

            <h3 className="entity-heading">{t('insights.products.detail.history')}</h3>
            <DataTable compact columns={columns} rows={data.history} rowKey={(h, i) => `${h.documentId}:${i}`} caption={t('insights.products.detail.history')} />
          </div>
        )}
      </div>
    </Sheet>
  );
}
