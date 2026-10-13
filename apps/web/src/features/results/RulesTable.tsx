import type { ExtractionReport, RuleScore } from '../../api/types';
import { Card } from '../../components/ui/Card';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { compareRuleIds } from '../../lib/compareRuleIds';
import { formatPercent } from '../../lib/formatPercent';

const COLUMNS: Column<RuleScore>[] = [
  { key: 'rule', header: 'Rule', cell: (r) => r.rule },
  { key: 'recall', header: 'Recall', cell: (r) => formatPercent(r.recall), numeric: true },
  { key: 'precision', header: 'Precision', cell: (r) => formatPercent(r.precision), numeric: true },
  { key: 'tp', header: 'Caught', cell: (r) => r.tp, numeric: true },
  { key: 'fp', header: 'False alarms', cell: (r) => r.fp, numeric: true, secondary: true },
  { key: 'fn', header: 'Missed', cell: (r) => r.fn, numeric: true },
];

/** Rules end to end on one evaluation set: PDFs read by the model, then the rules. */
export function RulesTable({ report }: { report: ExtractionReport }) {
  const rows = [...report.rules.table].sort((a, b) => compareRuleIds(a.rule, b.rule));
  return (
    <Card title="Rules on the extracted documents">
      <p className="muted small">
        End to end: PDFs read by the model, then the rules. A miss can come from extraction or from the rule. {report.rules.shipmentsWithAllDocuments} of {report.shipments} shipments
        had all their documents extracted.
      </p>
      <DataTable columns={COLUMNS} rows={rows} rowKey={(r) => r.rule} compact caption="Recall and precision per rule" />
    </Card>
  );
}
