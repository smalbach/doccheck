import type { RuleDefinition } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { useNow } from '../../hooks/useNow';
import { useI18n } from '../../i18n/useI18n';
import { formatDuration } from '../../lib/formatDuration';
import type { AgentQuestion } from '../../lib/progressTimeline';

export interface AgentQuestionItemProps {
  question: AgentQuestion;
  rule?: RuleDefinition;
  /** The run goes on: an unanswered question is being thought about (otherwise it was never answered). */
  running: boolean;
  /** Scrolls to the finding the question is about. */
  onShowFinding?: (findingId: string) => void;
}

/** Thinking shows its elapsed time once it is worth showing. */
const SHOW_ELAPSED_AFTER_MS = 1000;

/**
 * One agent question: the rule and the question; while the model thinks, a spinner and the time so far;
 * then its verdict with a confidence bar, the rationale and what it did to the finding (with a link to it).
 */
export function AgentQuestionItem({ question: q, rule, running, onShowFinding }: AgentQuestionItemProps) {
  const i18n = useI18n();
  const { t } = i18n;
  const thinking = running && !q.answer;
  const now = useNow(thinking);
  const elapsed = thinking && q.askedAt ? now - Date.parse(q.askedAt) : 0;
  const took = q.answer && q.askedAt && q.answeredAt ? Date.parse(q.answeredAt) - Date.parse(q.askedAt) : undefined;
  const confidence = q.answer ? Math.round(q.answer.confidence * 100) : 0;
  return (
    <li className={`agent-question${thinking ? ' agent-question-thinking' : ''}`}>
      <div className="agent-question-head">
        {q.ruleId && <span className="agent-question-rule">{t('progress.agent.rule', { rule: q.ruleId })}</span>}
        {rule && (
          <span className="muted" lang="en">
            {rule.title}
          </span>
        )}
      </div>
      <p className="agent-question-text" lang="en">
        {q.question}
      </p>
      {q.answer ? (
        <div className="agent-answer">
          <span className={`verdict verdict-${q.answer.verdict}`}>{t('progress.agent.verdict', { verdict: t(`shipment.agent.verdicts.${q.answer.verdict}`) })}</span>
          <span className="confidence">
            <span className="confidence-bar" aria-hidden>
              <span className={`confidence-fill verdict-bg-${q.answer.verdict}`} style={{ width: `${confidence}%` }} />
            </span>
            <span className="muted">{t('progress.agent.confidence', { confidence })}</span>
          </span>
          {took !== undefined && took >= 0 && <span className="muted">{t('progress.agent.took', { duration: formatDuration(took, i18n) })}</span>}
          {q.answer.rationale && (
            <p className="agent-rationale" lang="en">
              {q.answer.rationale}
            </p>
          )}
          <p className="agent-effect">
            {q.answer.effect && t(`progress.agent.effects.${q.answer.effect}`)}{' '}
            {q.findingId && onShowFinding && (
              <Button variant="link" size="sm" onClick={() => onShowFinding(q.findingId!)}>
                {t('progress.agent.showFinding')}
              </Button>
            )}
          </p>
        </div>
      ) : thinking ? (
        <p className="agent-thinking">
          <span className="spinner step-spinner" aria-hidden />{' '}
          {elapsed >= SHOW_ELAPSED_AFTER_MS ? t('progress.agent.thinkingFor', { duration: formatDuration(elapsed, i18n) }) : t('progress.agent.thinking')}
        </p>
      ) : (
        <p className="muted">{t('progress.agent.unanswered')}</p>
      )}
    </li>
  );
}
