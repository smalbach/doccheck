import type { ExtractionReport, RuleScore } from '../../api/types';
import { Card } from '../../components/ui/Card';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { useI18n } from '../../i18n/useI18n';
import { compareRuleIds } from '../../lib/compareRuleIds';

/** Rules end to end on one evaluation set: PDFs read by the model, then the rules. */
export function RulesTable({ report }: { report: ExtractionReport }) {
  const { t, formatPercent } = useI18n();
  const columns: Column<RuleScore>[] = [
    { key: 'rule', header: t('results.columns.rule'), cell: (r) => r.rule },
    { key: 'recall', header: t('results.columns.recall'), cell: (r) => formatPercent(r.recall), numeric: true },
    { key: 'precision', header: t('results.columns.precision'), cell: (r) => formatPercent(r.precision), numeric: true },
    { key: 'tp', header: t('results.columns.caught'), cell: (r) => r.tp, numeric: true },
    { key: 'fp', header: t('results.columns.falseAlarms'), cell: (r) => r.fp, numeric: true, secondary: true },
    { key: 'fn', header: t('results.columns.missed'), cell: (r) => r.fn, numeric: true },
  ];
  const rows = [...report.rules.table].sort((a, b) => compareRuleIds(a.rule, b.rule));
  return (
    <Card title={t('results.rulesTitle')}>
      <p className="muted small">{t('results.rulesText', { complete: report.rules.shipmentsWithAllDocuments, total: report.shipments })}</p>
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.rule} compact caption={t('results.rulesCaption')} />
    </Card>
  );
}
