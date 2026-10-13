import type { RuleDefinition, ValidationFinding } from '../../api/types';
import { Disclosure } from '../../components/ui/Disclosure';
import { useI18n } from '../../i18n/useI18n';
import { ruleGuideKey } from '../../lib/findingReview';

export interface ResolvedFindingsProps {
  findings: readonly ValidationFinding[];
  /** When the previous run was made. */
  since: string;
  rules: Readonly<Record<string, RuleDefinition>>;
}

/** Findings of the previous run that the latest one no longer has: corrected or fixed documents. */
export function ResolvedFindings({ findings, since, rules }: ResolvedFindingsProps) {
  const { t, formatDateTime } = useI18n();
  if (findings.length === 0) return null;
  return (
    <Disclosure summary={t('review.resolvedTitle', { count: findings.length, date: formatDateTime(since) })} defaultOpen>
      <ul className="resolved-list">
        {findings.map((f) => {
          const problem = ruleGuideKey(f.ruleId, 'problem');
          return (
            <li key={f.id}>
              <span className={`severity severity-${f.severity}`}>{t(`severity.${f.severity}`)}</span> <strong>{f.ruleId}</strong>{' '}
              {problem ? t(problem) : <span lang="en">{rules[f.ruleId]?.title ?? f.message}</span>}
              <span className="muted small block">{f.evidence.map((e) => `${e.field} = ${e.value || '—'}`).join(' · ')}</span>
            </li>
          );
        })}
      </ul>
    </Disclosure>
  );
}
