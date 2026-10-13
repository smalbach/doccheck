import type { RuleDefinition } from '../../api/types';
import { useI18n } from '../../i18n/useI18n';
import type { LiveFinding } from '../../lib/liveFindings';
import { sortFindings } from '../../lib/sortFindings';
import { FindingsSummary } from './FindingsSummary';
import { LiveFindingItem } from './LiveFindingItem';

export interface LiveFindingListProps {
  findings: readonly LiveFinding[];
  rules: Readonly<Record<string, RuleDefinition>>;
}

/** The findings of the running validation so far, in the stored list's order (dismissed ones stay, struck through). */
export function LiveFindingList({ findings, rules }: LiveFindingListProps) {
  const { t } = useI18n();
  if (findings.length === 0) return <p className="muted">{t('progress.live.nothingYet')}</p>;
  return (
    <>
      <FindingsSummary findings={findings.filter((f) => f.effect !== 'dismissed')} />
      <ol className="finding-list" aria-label={t('progress.live.list')}>
        {sortFindings(findings).map((f) => (
          <LiveFindingItem key={f.id} finding={f} rule={rules[f.ruleId]} />
        ))}
      </ol>
    </>
  );
}
