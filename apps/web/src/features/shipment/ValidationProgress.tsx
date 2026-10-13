import { useId } from 'react';
import { Disclosure } from '../../components/ui/Disclosure';
import { useI18n } from '../../i18n/useI18n';
import { formatDuration } from '../../lib/formatDuration';
import { runDuration, type RunTimeline } from '../../lib/progressTimeline';
import { AgentQuestionList } from './AgentQuestionList';
import { RunSteps } from './RunSteps';

export interface ValidationProgressProps {
  /** The shipment's latest validation run, from the event stream. */
  run?: RunTimeline;
  /** Validate was clicked here and the call has not answered yet. */
  validating: boolean;
  /** The validation shown in the card: the summary of a finished run only goes with its own findings. */
  shownId?: string;
}

/**
 * In the findings card: while a validation runs, its stages ("Rules 15/15 · Citations · Agent: question
 * 2 of 4…"); afterwards "Last run took 41 s", expandable to the same timeline. Not a live region (the
 * card is): ProgressAnnouncer says what changed, sparingly.
 */
export function ValidationProgress({ run, validating, shownId }: ValidationProgressProps) {
  const i18n = useI18n();
  const { t } = i18n;
  const titleId = useId();
  const running = run?.state === 'running';

  if (running || validating) {
    return (
      <section className="run-panel" aria-labelledby={titleId} aria-live="off" aria-busy="true">
        <h3 id={titleId} className="run-panel-title">
          <span className="spinner step-spinner" aria-hidden /> {t('progress.validation.title')}
        </h3>
        {running ? (
          <>
            <RunSteps run={run} label={t('progress.validation.steps')} />
            <AgentQuestionList questions={run.questions} running />
          </>
        ) : (
          <p className="muted small">{t('progress.validation.starting')}</p>
        )}
      </section>
    );
  }

  if (!run || run.runId !== shownId) return null;
  const duration = formatDuration(runDuration(run), i18n);
  return (
    <div className="run-summary">
      <Disclosure summary={run.state === 'done' ? t('progress.validation.lastRun', { duration }) : t('progress.validation.failed', { duration })}>
        <RunSteps run={run} label={t('progress.validation.steps')} />
        <AgentQuestionList questions={run.questions} running={false} />
      </Disclosure>
    </div>
  );
}
