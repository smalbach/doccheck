import { useI18n } from '../../i18n/useI18n';
import type { AgentQuestion } from '../../lib/progressTimeline';

/**
 * The agent's questions of a run: answered ones with verdict and confidence; while the run goes on, the
 * pending one with a spinner (a question left unanswered by a failed agent shows no answer).
 */
export function AgentQuestionList({ questions, running }: { questions: readonly AgentQuestion[]; running: boolean }) {
  const { t } = useI18n();
  if (questions.length === 0) return null;
  return (
    <ol className="run-questions" aria-label={t('progress.validation.questions')}>
      {questions.map((q) => (
        <li key={q.index}>
          <span>{q.question ?? q.ruleId}</span>{' '}
          {q.answer ? (
            <span className={`verdict verdict-${q.answer.verdict}`}>
              {t('progress.validation.answer', { verdict: t(`shipment.agent.verdicts.${q.answer.verdict}`), confidence: Math.round(q.answer.confidence * 100) })}
            </span>
          ) : (
            running && <span className="spinner step-spinner" aria-hidden />
          )}
        </li>
      ))}
    </ol>
  );
}
