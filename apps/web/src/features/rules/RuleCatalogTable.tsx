import type { RuleDefinition } from '../../api/types';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { DOCUMENT_TYPE_KEY } from '../../constants/documentTypes';
import { useI18n } from '../../i18n/useI18n';
import { compareRuleIds } from '../../lib/compareRuleIds';

export function RuleCatalogTable({ rules }: { rules: readonly RuleDefinition[] }) {
  const { t } = useI18n();
  const columns: Column<RuleDefinition>[] = [
    { key: 'id', header: t('rules.columns.rule'), cell: (r) => <strong>{r.id}</strong> },
    { key: 'title', header: t('rules.columns.title'), cell: (r) => <span lang="en">{r.title}</span> },
    { key: 'requires', header: t('rules.columns.needs'), cell: (r) => <span className="muted small">{r.requires.map((d) => t(DOCUMENT_TYPE_KEY[d])).join(', ') || '—'}</span>, secondary: true },
    { key: 'kind', header: t('rules.columns.kind'), cell: (r) => <span className="muted small" lang="en">{r.kind.toLowerCase().replace(/_/g, ' ')}</span>, secondary: true },
    { key: 'severity', header: t('rules.columns.severity'), cell: (r) => <span className={`severity severity-${r.severity}`}>{t(`severity.${r.severity}`)}</span> },
  ];
  const sorted = [...rules].sort((a, b) => compareRuleIds(a.id, b.id));
  return <DataTable columns={columns} rows={sorted} rowKey={(r) => r.id} caption={t('rules.caption')} />;
}
