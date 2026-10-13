import { useId, useState } from 'react';
import type { RuleDefinition } from '../../api/types';
import { Disclosure } from '../../components/ui/Disclosure';
import { useI18n } from '../../i18n/useI18n';
import { formatDuration } from '../../lib/formatDuration';
import { runDuration, type RunTimeline } from '../../lib/progressTimeline';
import { validationCaption } from '../../lib/validationCaption';
import { AgentQuestionList } from './AgentQuestionList';
import { RunSteps } from './RunSteps';

export interface ValidationProgressProps {
  /** The shipment's latest validation run, from the event stream. */
  run?: RunTimeline;
  /** Validate was clicked here and the call has not answered yet. */
  validating: boolean;
  /** The validation shown in the card: the summary of a finished run only goes with its own findings. */
  shownId?: string;
  rules: Readonly<Record<string, RuleDefinition>>;
  /** Scrolls to the finding an agent question is about. */
  onShowFinding?: (findingId: string) => void;
}

/**
 * In the findings card: while a validation runs, a plain-language line of what it does now, its stages
 * ("Rules 15/15 · Citations · Agent: question 2 of 4…") and the agent's questions as they are asked and
 * answered; afterwards "Last run took 41 s", expandable to the same timeline. Not a live region (the
 * card is, once the run is saved): ProgressAnnouncer says what changed, sparingly.
 */
export function ValidationProgress({ run, validating, shownId, rules, onShowFinding }: ValidationProgressProps) {
  const i18n = useI18n();
  const { t } = i18n;
  const titleId = useId();
  const running = run?.state === 'running';
  // The run that was latest when Validate was clicked: until another one starts, this tab's is still coming.
  const [before, setBefore] = useState<string>();
  const [wasValidating, setWasValidating] = useState(validating);
  if (validating !== wasValidating) {
    setWasValidating(validating);
    if (validating) setBefore(run?.runId);
  }

  if (running || validating) {
    // This tab's run, also once saved while the call has not answered yet.
    const current = run && (running || (validating && run.runId !== before)) ? run : undefined;
    const caption = current ? (validationCaption(current) ?? { key: 'progress.caption.saving' as const }) : validationCaption(undefined);
    return (
      <section className="run-panel" aria-labelledby={titleId} aria-live="off" aria-busy="true">
        <h3 id={titleId} className="run-panel-title">
          <span className="spinner step-spinner" aria-hidden /> {t('progress.validation.title')}
        </h3>
        {caption && <p className="run-caption">{t(caption.key, caption.vars)}</p>}
        {current && (
          <>
            <RunSteps run={current} label={t('progress.validation.steps')} />
            <AgentQuestionList run={current} rules={rules} onShowFinding={onShowFinding} />
          </>
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
        <AgentQuestionList run={run} rules={rules} onShowFinding={onShowFinding} />
      </Disclosure>
    </div>
  );
}
