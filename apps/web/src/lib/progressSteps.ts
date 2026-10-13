import type { ExtractionStage, ValidationStage } from '../api/types';
import type { MessageKey, MessageVars } from '../i18n/keys';
import type { RunTimeline, StepState } from './progressTimeline';

export type StepDisplay = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

/** One stage as the stepper shows it. `note` is a short translated hint (page 2 of 3, 15/15, the model). */
export interface StepView {
  stage: ExtractionStage | ValidationStage;
  display: StepDisplay;
  durationMs?: number;
  /** While running: when it started (ISO), for an elapsed time. */
  startedAt?: string;
  note?: { key: MessageKey; vars?: MessageVars };
  error?: string;
}

/** Stages shown for an extraction, in order; `ocr` only when the document needed it. */
export const EXTRACTION_STEPS = ['queued', 'reading', 'ocr', 'classifying', 'extracting', 'normalizing', 'saved'] as const satisfies readonly ExtractionStage[];
/** Stages shown for a validation, in order (`started` is only a marker). */
export const VALIDATION_STEPS = ['rules', 'citations', 'agent', 'saved'] as const satisfies readonly ValidationStage[];

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

function displayOf(step: StepState | undefined): StepDisplay {
  if (!step) return 'pending';
  if (step.status === 'started' || step.status === 'progress') return 'running';
  return step.status;
}

/** The hint under a stage, from what its events reported. */
function noteOf(stage: StepView['stage'], step: StepState, display: StepDisplay): StepView['note'] {
  const d = step.detail;
  const reason = str(d.reason);
  if (display === 'skipped') {
    if (reason === 'type-given') return { key: 'progress.notes.typeGiven' };
    if (reason === 'no-index') return { key: 'progress.notes.noIndex' };
    if (reason === 'disabled') return { key: 'progress.notes.disabled' };
    return undefined;
  }
  if (display === 'failed') return d.willRetry ? { key: 'progress.notes.retrying' } : undefined;
  switch (stage) {
    case 'queued':
      return display === 'running' && num(d.position) ? { key: 'progress.notes.position', vars: { position: num(d.position)! } } : undefined;
    case 'ocr':
      if (display === 'running' && num(d.page) && num(d.pages)) return { key: 'progress.notes.page', vars: { page: num(d.page)!, pages: num(d.pages)! } };
      return display === 'done' && num(d.confidence) !== undefined ? { key: 'progress.notes.confidence', vars: { confidence: num(d.confidence)! } } : undefined;
    case 'extracting':
      if (!str(d.model)) return undefined;
      return d.cached === true && display === 'done' ? { key: 'progress.notes.modelCached', vars: { model: str(d.model)! } } : { key: 'progress.notes.model', vars: { model: str(d.model)! } };
    case 'rules': {
      const total = num(d.total);
      const count = display === 'done' ? num(d.ran) : num(d.index);
      return total !== undefined && count !== undefined ? { key: 'progress.notes.count', vars: { count, total } } : undefined;
    }
    case 'citations':
      return display === 'done' && num(d.citations) !== undefined ? { key: 'progress.notes.citations', vars: { count: num(d.citations)! } } : undefined;
    default:
      return undefined;
  }
}

/** The agent's note: which question it is on while running, how many it decided once done. */
function agentNote(run: RunTimeline, step: StepState, display: StepDisplay): StepView['note'] {
  const total = num(step.detail.total) ?? run.questions[0]?.total;
  if (display === 'running') {
    const asked = run.questions.length;
    if (total === undefined) return undefined;
    if (asked === 0) return { key: 'progress.notes.questions', vars: { count: total } };
    return { key: 'progress.notes.question', vars: { index: asked, total } };
  }
  if (display === 'done') return { key: 'progress.notes.decisions', vars: { count: num(step.detail.decisions) ?? run.questions.length } };
  return noteOf('agent', step, display);
}

/**
 * The stepper of a run. While it runs, stages not reached yet are pending; once it ended, stages it
 * never reached are left out (an extraction that failed while reading has no model step).
 */
export function stepsOf(run: RunTimeline): StepView[] {
  const order: readonly StepView['stage'][] = run.kind === 'extraction' ? EXTRACTION_STEPS : VALIDATION_STEPS;
  const views: StepView[] = [];
  for (const stage of order) {
    const step = run.steps[stage];
    if (stage === 'ocr' && !step) continue;
    if (!step && run.state !== 'running') continue;
    const display = displayOf(step);
    const view: StepView = { stage, display };
    if (step) {
      if (step.durationMs !== undefined) view.durationMs = step.durationMs;
      if (display === 'running' && step.startedAt) view.startedAt = step.startedAt;
      view.note = stage === 'agent' ? agentNote(run, step, display) : noteOf(stage, step, display);
      if (step.error) view.error = step.error;
    }
    views.push(view);
  }
  return views;
}

/** The stage a running run is in (the last one started and not ended). */
export function currentStep(views: readonly StepView[]): StepView | undefined {
  return [...views].reverse().find((v) => v.display === 'running');
}
