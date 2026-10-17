import type { ReactNode } from 'react';
import type { KpiGroup } from '../../api/analytics';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { useI18n } from '../../i18n/useI18n';
import { RateCell } from './RateCell';

export interface GroupTableProps {
  title: string;
  rows: readonly KpiGroup[];
  name: (g: KpiGroup) => ReactNode;
  /** How many rows show; the rest are in the CSV. */
  limit?: number;
}

/** One KPI breakdown: each group's error rate (shipments with findings on the first validation), shipments and findings. */
export function GroupTable({ title, rows, name, limit = 12 }: GroupTableProps) {
  const { t, formatNumber } = useI18n();
  const columns: Column<KpiGroup>[] = [
    { key: 'group', header: t('analytics.kpis.columns.group'), cell: (g) => <span className="cell-wide">{name(g)}</span> },
    { key: 'rate', header: t('analytics.kpis.columns.errorRate'), cell: (g) => <RateCell part={g.withFindings} total={g.shipments} /> },
    { key: 'with', header: t('analytics.kpis.columns.withFindings'), cell: (g) => `${formatNumber(g.withFindings)} / ${formatNumber(g.shipments)}`, numeric: true, secondary: true },
    { key: 'findings', header: t('analytics.kpis.columns.findings'), cell: (g) => formatNumber(g.findings), numeric: true },
  ];
  return (
    <section>
      <h2 className="section-title">{title}</h2>
      {rows.length === 0 ? (
        <p className="muted small">{t('analytics.common.none')}</p>
      ) : (
        <DataTable columns={columns} rows={rows.slice(0, limit)} rowKey={(g) => g.key} caption={title} compact />
      )}
    </section>
  );
}
