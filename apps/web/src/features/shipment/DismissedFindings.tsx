import type { RuleDefinition } from '../../api/types';
import { Disclosure } from '../../components/ui/Disclosure';
import { useI18n } from '../../i18n/useI18n';
import type { LiveFinding } from '../../lib/liveFindings';
import { LiveFindingItem } from './LiveFindingItem';

export interface DismissedFindingsProps {
  findings: readonly LiveFinding[];
  rules: Readonly<Record<string, RuleDefinition>>;
}

/**
 * Under the stored findings: the ones the agent dismissed in this run (the stored validation does not
 * keep them), known from its events, so they do not vanish when the run is saved.
 */
export function DismissedFindings({ findings, rules }: DismissedFindingsProps) {
  const { t } = useI18n();
  if (findings.length === 0) return null;
  return (
    <Disclosure summary={t('progress.live.dismissed', { count: findings.length })} defaultOpen>
      <ol className="finding-list">
        {findings.map((f) => (
          <LiveFindingItem key={f.id} finding={f} rule={rules[f.ruleId]} settled />
        ))}
      </ol>
    </Disclosure>
  );
}
