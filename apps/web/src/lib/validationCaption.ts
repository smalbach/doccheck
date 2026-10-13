import type { MessageKey, MessageVars } from '../i18n/keys';
import { VALIDATION_STEPS } from './progressSteps';
import type { RunTimeline } from './progressTimeline';

export interface Caption {
  key: MessageKey;
  vars?: MessageVars;
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/**
 * One plain-language line saying what a running validation does now ("Checking 15 rules across the 3
 * documents"), for people who do not read steppers. Between two stages it describes the next one.
 * Undefined once the run ended.
 */
export function validationCaption(run: RunTimeline | undefined): Caption | undefined {
  if (!run) return { key: 'progress.caption.starting' };
  if (run.state !== 'running') return undefined;
  const reached = VALIDATION_STEPS.filter((s) => run.steps[s]);
  const last = reached.at(-1);
  const lastStep = last && run.steps[last];
  const ended = lastStep && lastStep.status !== 'started' && lastStep.status !== 'progress';
  const stage = !last ? 'rules' : ended ? (VALIDATION_STEPS[VALIDATION_STEPS.indexOf(last) + 1] ?? last) : last;
  switch (stage) {
    case 'rules': {
      const d = run.steps.rules?.detail ?? {};
      const documents = num(d.documents);
      const total = num(d.total);
      if (documents === undefined || total === undefined) return { key: 'progress.caption.rulesStarting' };
      return { key: 'progress.caption.rules', vars: { count: documents, total } };
    }
    case 'citations':
      return { key: 'progress.caption.citations' };
    case 'agent': {
      const total = num(run.steps.agent?.detail.total);
      if (total === undefined) return { key: 'progress.caption.agentStarting' };
      return total === 0 ? { key: 'progress.caption.agentNone' } : { key: 'progress.caption.agent', vars: { count: total } };
    }
    default:
      return { key: 'progress.caption.saving' };
  }
}

/**
 * The validation run the findings card shows live instead of the stored validation: one running, or
 * one that ended well while the stored validation (the source of truth) has not caught up with it yet,
 * so the card does not flash back to the previous run. `storedLoaded`: the first fetch has answered.
 */
export function liveValidationRun(run: RunTimeline | undefined, storedId: string | undefined, storedLoaded: boolean): RunTimeline | undefined {
  if (!run || run.kind !== 'validation') return undefined;
  if (run.state === 'running') return run;
  return run.state === 'done' && storedLoaded && run.runId !== storedId ? run : undefined;
}
