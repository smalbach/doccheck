import type { RuleDefinition } from '../../api/types';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { DOCUMENT_TYPE_LABEL } from '../../constants/documentTypes';
import { compareRuleIds } from '../../lib/compareRuleIds';

const COLUMNS: Column<RuleDefinition>[] = [
  { key: 'id', header: 'Rule', cell: (r) => <strong>{r.id}</strong> },
  { key: 'title', header: 'What it checks', cell: (r) => r.title },
  { key: 'requires', header: 'Needs', cell: (r) => <span className="muted small">{r.requires.map((t) => DOCUMENT_TYPE_LABEL[t]).join(', ') || '—'}</span>, secondary: true },
  { key: 'kind', header: 'Kind', cell: (r) => <span className="muted small">{r.kind.toLowerCase().replace(/_/g, ' ')}</span>, secondary: true },
  { key: 'severity', header: 'Severity', cell: (r) => <span className={`severity severity-${r.severity}`}>{r.severity}</span> },
];

export function RuleCatalogTable({ rules }: { rules: readonly RuleDefinition[] }) {
  const sorted = [...rules].sort((a, b) => compareRuleIds(a.id, b.id));
  return <DataTable columns={COLUMNS} rows={sorted} rowKey={(r) => r.id} caption="Rules" />;
}
