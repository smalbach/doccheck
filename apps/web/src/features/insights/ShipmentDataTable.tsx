import type { ShipmentData } from '../../api/types';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { useI18n } from '../../i18n/useI18n';

export function ShipmentDataTable({ rows }: { rows: readonly ShipmentData[] }) {
  const { t, formatNumber, formatMoney } = useI18n();
  const columns: Column<ShipmentData>[] = [
    {
      key: 'shipment',
      header: t('insights.columns.shipment'),
      cell: (s) => (
        <>
          <a href={`#/app/s/${s.shipmentId}`} className="nowrap">{s.reference ?? s.shipmentId.slice(0, 8)}</a>
          <span className="muted small block nowrap">{[s.destination, s.invoiceNumber].filter(Boolean).join(' · ')}</span>
        </>
      ),
    },
    {
      key: 'parties',
      header: t('insights.columns.parties'),
      cell: (s) => (
        <div className="cell-wide">
          {s.seller ?? '—'}
          <span className="muted small block">→ {s.buyer ?? '—'}</span>
        </div>
      ),
      secondary: true,
    },
    { key: 'incoterm', header: t('insights.columns.incoterm'), cell: (s) => <span className="nowrap">{s.incoterm ?? '—'}</span>, secondary: true },
    { key: 'value', header: t('insights.columns.value'), cell: (s) => <span className="nowrap">{s.invoiceTotal ? formatMoney(s.invoiceTotal.amount, s.invoiceTotal.currency) : '—'}</span>, numeric: true },
    { key: 'lines', header: t('insights.columns.lines'), cell: (s) => s.lines, numeric: true, secondary: true },
    { key: 'packages', header: t('insights.columns.packages'), cell: (s) => (s.packages === undefined ? '—' : formatNumber(s.packages)), numeric: true },
    {
      key: 'weight',
      header: t('insights.columns.weight'),
      cell: (s) => (
        <>
          <span className="nowrap">{s.grossKg ? `${formatNumber(s.grossKg, 1)} kg` : '—'}</span>
          {s.netKg && <span className="muted small block nowrap">{t('insights.netShort', { kg: formatNumber(s.netKg, 1) })}</span>}
        </>
      ),
      numeric: true,
    },
    {
      key: 'route',
      header: t('insights.columns.route'),
      cell: (s) => (
        <>
          {s.portOfLoading || s.portOfDischarge ? `${s.portOfLoading ?? '?'} → ${s.portOfDischarge ?? '?'}` : '—'}
          {s.vessel && <span className="muted small block">{s.vessel}</span>}
        </>
      ),
      secondary: true,
    },
    {
      key: 'containers',
      header: t('insights.columns.containers'),
      cell: (s) => (s.containers.length ? <span className="mono small">{s.containers.join(', ')}</span> : '—'),
      secondary: true,
    },
  ];
  return <DataTable columns={columns} rows={rows} rowKey={(s) => s.shipmentId} caption={t('insights.tabs.shipments')} />;
}
