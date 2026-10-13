import type { RuleDefinition } from '../../api/types';
import { useI18n } from '../../i18n/useI18n';
import { agentStatus, type RunTimeline } from '../../lib/progressTimeline';
import { AgentQuestionItem } from './AgentQuestionItem';

export interface AgentQuestionListProps {
  run: RunTimeline;
  rules: Readonly<Record<string, RuleDefinition>>;
  /** Scrolls to the finding a question is about. */
  onShowFinding?: (findingId: string) => void;
}

/**
 * The agent's questions of a validation run, each with its rule, the model thinking, then its verdict
 * and effect. When the agent was off, failed or had nothing to ask, one line says so: the rule findings
 * stand either way.
 */
export function AgentQuestionList({ run, rules, onShowFinding }: AgentQuestionListProps) {
  const { t } = useI18n();
  const running = run.state === 'running';
  const status = agentStatus(run);
  return (
    <>
      {run.questions.length > 0 && (
        <ol className="agent-questions" aria-label={t('progress.validation.questions')}>
          {run.questions.map((q) => (
            <AgentQuestionItem key={q.index} question={q} rule={q.ruleId ? rules[q.ruleId] : undefined} running={running} onShowFinding={onShowFinding} />
          ))}
        </ol>
      )}
      {status === 'disabled' && <p className="muted small">{t('progress.agent.disabled')}</p>}
      {status === 'failed' && <p className="muted small">{t('progress.agent.failed')}</p>}
      {status === 'none' && <p className="muted small">{t('progress.agent.none')}</p>}
    </>
  );
}
