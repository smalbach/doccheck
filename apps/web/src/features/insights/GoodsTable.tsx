import type { GoodsLine } from '../../api/types';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { useI18n } from '../../i18n/useI18n';
import { formatHsCode } from '../../lib/formatHsCode';

export function GoodsTable({ lines }: { lines: readonly GoodsLine[] }) {
  const { t, formatNumber, formatMoney } = useI18n();
  const columns: Column<GoodsLine>[] = [
    {
      key: 'shipment',
      header: t('insights.columns.shipment'),
      cell: (l) => (
        <>
          <a href={`#/app/s/${l.shipmentId}`} className="nowrap">{l.reference ?? l.shipmentId.slice(0, 8)}</a>
          {l.invoiceNumber && <span className="muted small block">{l.invoiceNumber}</span>}
        </>
      ),
    },
    {
      key: 'description',
      header: t('insights.columns.description'),
      cell: (l) => (
        <>
          {l.description}
          {l.sku && <span className="muted small block">{l.sku}</span>}
        </>
      ),
    },
    { key: 'hs', header: t('insights.columns.hs'), cell: (l) => (l.hsCode ? <span className="mono nowrap">{formatHsCode(l.hsCode)}</span> : '—'), secondary: true },
    { key: 'origin', header: t('insights.columns.originShort'), cell: (l) => l.countryOfOrigin ?? '—', secondary: true },
    { key: 'quantity', header: t('insights.columns.quantity'), cell: (l) => <span className="nowrap">{l.quantity ? `${formatNumber(l.quantity.value)} ${l.quantity.unit}` : '—'}</span>, numeric: true },
    { key: 'unitPrice', header: t('insights.columns.unitPrice'), cell: (l) => <span className="nowrap">{l.unitPrice ? formatMoney(l.unitPrice.amount, l.unitPrice.currency) : '—'}</span>, numeric: true, secondary: true },
    { key: 'total', header: t('insights.columns.total'), cell: (l) => <span className="nowrap">{l.lineTotal ? formatMoney(l.lineTotal.amount, l.lineTotal.currency) : '—'}</span>, numeric: true },
  ];
  return <DataTable columns={columns} rows={lines} rowKey={(l) => `${l.documentId}:${l.lineNo}`} caption={t('insights.tabs.goods')} />;
}
