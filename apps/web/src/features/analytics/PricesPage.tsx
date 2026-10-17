import { useState } from 'react';
import { analyticsApi, type AnalyticsFilter, type PriceGroup, type PriceGroupBy, type PricePoint } from '../../api/analytics';
import { LoadingCard } from '../../components/layout/LoadingCard';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Checkbox } from '../../components/ui/Checkbox';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { EmptyState } from '../../components/ui/EmptyState';
import { Tag } from '../../components/ui/Tag';
import { TextInput } from '../../components/ui/TextInput';
import { ToggleChips } from '../../components/ui/ToggleChips';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useQuery } from '../../hooks/useQuery';
import { useI18n } from '../../i18n/useI18n';
import { countryName } from '../../lib/countryName';
import { formatHsCode } from '../../lib/formatHsCode';
import { AnalyticsPage } from './AnalyticsPage';
import { PriceStrip } from './PriceStrip';

const groupId = (g: Pick<PriceGroup, 'key' | 'currency' | 'unit'>) => `${g.key}|${g.currency}|${g.unit}`;

/** Unit price spread per product or per HS-6 and origin, outliers first; a group opens its strip of prices. */
export function PricesPage() {
  return (
    <AnalyticsPage titleKey="analytics.prices.title" descriptionKey="analytics.prices.description" noDates>
      {(filter) => <PricesBody filter={filter} />}
    </AnalyticsPage>
  );
}

function PricesBody({ filter }: { filter: AnalyticsFilter }) {
  const { t, locale, formatMoney, formatNumber } = useI18n();
  const [by, setBy] = useState<PriceGroupBy>('product');
  const [query, setQuery] = useState('');
  const [outliers, setOutliers] = useState(false);
  const [open, setOpen] = useState<PriceGroup>();
  const q = useDebouncedValue(query.trim(), 300);
  const { data, error } = useQuery(`prices:${filter.destination ?? ''}:${by}:${q}:${outliers}`, () => analyticsApi.prices({ destination: filter.destination, by, q: q || undefined, outliers }));
  const name = (g: PriceGroup) => (by === 'hs6' ? formatHsCode(g.hs6 ?? g.label) : g.label);
  const columns: Column<PriceGroup>[] = [
    {
      key: 'group',
      header: t('analytics.prices.columns.group'),
      cell: (g) => (
        <Button variant="link" size="sm" onClick={() => setOpen(g)} aria-expanded={open ? groupId(open) === groupId(g) : false}>
          {name(g)}
        </Button>
      ),
    },
    { key: 'origin', header: t('analytics.prices.columns.origin'), cell: (g) => (g.origin ? countryName(g.origin, locale) : '—'), secondary: true },
    { key: 'unit', header: t('analytics.prices.columns.unit'), cell: (g) => <span className="nowrap">{g.unit ? `${g.currency} / ${g.unit}` : g.currency}</span> },
    { key: 'n', header: t('analytics.prices.columns.n'), cell: (g) => formatNumber(g.stats.n), numeric: true },
    { key: 'median', header: t('analytics.prices.columns.median'), cell: (g) => <span className="nowrap">{formatMoney(g.stats.median, g.currency)}</span>, numeric: true },
    {
      key: 'range',
      header: t('analytics.prices.columns.range'),
      cell: (g) => <span className="nowrap">{`${formatMoney(g.stats.q1, g.currency)} – ${formatMoney(g.stats.q3, g.currency)}`}</span>,
      numeric: true,
      secondary: true,
    },
    { key: 'outliers', header: t('analytics.prices.columns.outliers'), cell: (g) => (g.outliers ? <Tag tone="accent">{formatNumber(g.outliers)}</Tag> : '0'), numeric: true },
  ];
  return (
    <>
      <Card>
        <div className="filters">
          <ToggleChips
            value={by}
            onValueChange={(v) => {
              setBy(v);
              setOpen(undefined);
            }}
            ariaLabel={t('analytics.prices.by')}
            options={[
              { value: 'product', label: t('analytics.prices.byProduct') },
              { value: 'hs6', label: t('analytics.prices.byHs') },
            ]}
          />
          <div className="filters-right">
            <TextInput className="filters-grow" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('analytics.prices.search')} aria-label={t('analytics.prices.search')} />
            <Checkbox label={t('analytics.prices.outliersOnly')} checked={outliers} onCheckedChange={setOutliers} />
          </div>
        </div>
        {!data ? (
          <LoadingCard error={error} />
        ) : data.length === 0 ? (
          <EmptyState title={q || outliers ? t('analytics.prices.noMatch') : t('analytics.prices.none')} />
        ) : (
          <DataTable columns={columns} rows={data} rowKey={groupId} caption={t('analytics.prices.caption')} compact />
        )}
        <p className="muted small">{t('analytics.prices.how')}</p>
      </Card>
      {open && <PriceGroupCard key={groupId(open)} group={open} by={by} filter={filter} title={name(open)} onClose={() => setOpen(undefined)} />}
    </>
  );
}

function PriceGroupCard({ group, by, filter, title, onClose }: { group: PriceGroup; by: PriceGroupBy; filter: AnalyticsFilter; title: string; onClose: () => void }) {
  const { t, formatMoney, formatNumber } = useI18n();
  const { data, error } = useQuery(`price-group:${groupId(group)}:${filter.destination ?? ''}`, () =>
    analyticsApi.priceGroup({ destination: filter.destination, by, key: group.key, currency: group.currency, unit: group.unit }),
  );
  const money = (v: string) => formatMoney(v, group.currency);
  const columns: Column<PricePoint>[] = [
    { key: 'date', header: t('analytics.prices.detail.columns.date'), cell: (p) => <span className="nowrap">{p.invoiceDate ?? '—'}</span> },
    { key: 'shipment', header: t('analytics.prices.detail.columns.shipment'), cell: (p) => <a className="nowrap" href={`#/app/s/${p.shipmentId}`}>{p.reference ?? p.shipmentId.slice(0, 8)}</a> },
    { key: 'seller', header: t('analytics.prices.detail.columns.seller'), cell: (p) => p.seller ?? '—', secondary: true },
    { key: 'description', header: t('analytics.prices.detail.columns.description'), cell: (p) => <span className="cell-wide">{p.description}</span>, secondary: true },
    { key: 'quantity', header: t('analytics.prices.detail.columns.quantity'), cell: (p) => (p.quantity ? `${formatNumber(p.quantity)} ${group.unit}` : '—'), numeric: true, secondary: true },
    { key: 'price', header: t('analytics.prices.detail.columns.price'), cell: (p) => <span className="nowrap">{money(p.unitPrice)}</span>, numeric: true },
    { key: 'flag', header: t('analytics.prices.detail.columns.flag'), cell: (p) => (p.outlier ? <Tag tone="accent">{t('analytics.prices.outlierTag')}</Tag> : '') },
  ];
  return (
    <Card title={title} aside={<Button size="sm" onClick={onClose}>{t('common.close')}</Button>}>
      {!data ? (
        <LoadingCard error={error} />
      ) : (
        <>
          <PriceStrip
            points={data.points}
            stats={data.stats}
            format={money}
            describe={(p) => [money(p.unitPrice), p.invoiceDate, p.reference, p.seller, p.outlier ? t('analytics.prices.outlierTag') : undefined].filter(Boolean).join(' · ')}
            ariaLabel={t('analytics.prices.detail.chart', { currency: group.currency, unit: group.unit || '—', median: money(data.stats.median), q1: money(data.stats.q1), q3: money(data.stats.q3), outliers: data.outliers })}
          />
          <ul className="chart-legend" aria-label={t('analytics.prices.detail.fences')}>
            <li>
              <span className="legend-swatch legend-dot" aria-hidden /> {t('analytics.prices.detail.legendPrice')}
            </li>
            <li>
              <span className="legend-swatch legend-diamond" aria-hidden /> {t('analytics.prices.detail.legendOutlier')}
            </li>
            <li>
              <span className="legend-swatch legend-band" aria-hidden /> {t('analytics.prices.detail.legendBand')}
            </li>
            {data.stats.low !== undefined && data.stats.high !== undefined && (
              <li>
                <span className="legend-swatch legend-fence" aria-hidden /> {t('analytics.prices.detail.fences')}: {money(data.stats.low)} – {money(data.stats.high)}
              </li>
            )}
          </ul>
          <h3 className="section-title">{t('analytics.prices.detail.points')}</h3>
          <DataTable columns={columns} rows={data.points} rowKey={(_, i) => String(i)} caption={t('analytics.prices.detail.pointsCaption')} compact />
        </>
      )}
    </Card>
  );
}
