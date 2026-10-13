import type { AgentAnswer, ProgressEvent, ProgressKind, ProgressStatus } from '../api/types';

/** One stage of a run as last reported. `status` is the latest event's (progress while it runs). */
export interface StepState {
  status: ProgressStatus;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  /** Details of every event of the stage, later ones winning. */
  detail: Record<string, unknown>;
  error?: string;
}

/** One agent question of a validation, as asked and (once answered) with its answer. */
export interface AgentQuestion {
  index: number;
  total?: number;
  ruleId?: string;
  question?: string;
  answer?: AgentAnswer;
}

/** One extraction of a document or one validation, built from its events. */
export interface RunTimeline {
  kind: ProgressKind;
  runId: string;
  documentId?: string;
  startedAt: string;
  /** When the final `saved` event arrived. */
  endedAt?: string;
  /** running until `saved` ends the run (a failure the queue retries keeps it running). */
  state: 'running' | 'done' | 'failed';
  steps: Partial<Record<string, StepState>>;
  questions: AgentQuestion[];
  /** Highest event id applied. */
  lastId: number;
}

/** Latest run of each document and the latest validation of a shipment. */
export interface ProgressState {
  documents: Readonly<Record<string, RunTimeline>>;
  validation?: RunTimeline;
}

export const EMPTY_PROGRESS: ProgressState = { documents: {} };

const ENDS: readonly ProgressStatus[] = ['done', 'failed', 'skipped'];

/** A retry starts over: a new `queued` or `reading` start clears the stages that came after it. */
function restarts(run: RunTimeline, e: ProgressEvent): boolean {
  if (e.status !== 'started' || run.kind !== 'extraction') return false;
  const later = Object.keys(run.steps).filter((s) => s !== 'queued');
  return (e.stage === 'queued' && later.length > 0) || (e.stage === 'reading' && later.some((s) => s !== 'reading'));
}

function applyStep(prev: StepState | undefined, e: ProgressEvent): StepState {
  const detail = { ...(prev?.detail ?? {}), ...e.detail };
  if (e.status === 'started') return { status: 'started', startedAt: e.at, detail };
  const step: StepState = { ...prev, status: e.status, detail, startedAt: prev?.startedAt ?? e.at };
  if (ENDS.includes(e.status)) {
    step.endedAt = e.at;
    if (e.durationMs !== undefined) step.durationMs = e.durationMs;
  }
  if (e.status === 'failed') step.error = typeof e.detail.error === 'string' ? e.detail.error : undefined;
  return step;
}

function applyQuestion(questions: AgentQuestion[], e: ProgressEvent): AgentQuestion[] {
  if (e.kind !== 'validation' || e.stage !== 'agent' || e.status !== 'progress' || !e.detail.index) return questions;
  const { index, total, ruleId, question, answer } = e.detail;
  const next = questions.filter((q) => q.index !== index);
  next.push({ index, total, ruleId, question, answer });
  return next.sort((a, b) => a.index - b.index);
}

function runState(run: RunTimeline): RunTimeline['state'] {
  const saved = run.steps.saved;
  if (saved?.status === 'done') return 'done';
  if (saved?.status === 'failed' && !saved.detail.willRetry) return 'failed';
  return 'running';
}

/** The run with this event applied: a fresh run for a new runId (unless the event is older), otherwise updated. */
export function applyToRun(run: RunTimeline | undefined, e: ProgressEvent): RunTimeline | undefined {
  // Already applied (a replay after a reconnect), or an event of an older run.
  if (run && e.id <= run.lastId) return run;
  const base: RunTimeline =
    run && run.runId === e.runId && !restarts(run, e)
      ? run
      : { kind: e.kind, runId: e.runId, documentId: e.documentId, startedAt: run?.runId === e.runId ? run.startedAt : e.at, state: 'running', steps: {}, questions: [], lastId: 0 };
  const next: RunTimeline = {
    ...base,
    steps: { ...base.steps, [e.stage]: applyStep(base.steps[e.stage], e) },
    questions: applyQuestion(base.questions, e),
    lastId: Math.max(base.lastId, e.id),
  };
  next.state = runState(next);
  next.endedAt = next.state === 'running' ? undefined : (next.steps.saved?.endedAt ?? e.at);
  return next;
}

/** The state with one more event. Pure; applying an event twice changes nothing. */
export function applyEvent(state: ProgressState, e: ProgressEvent): ProgressState {
  if (e.kind === 'validation') return { ...state, validation: applyToRun(state.validation, e) };
  if (!e.documentId) return state;
  const run = applyToRun(state.documents[e.documentId], e);
  return run ? { ...state, documents: { ...state.documents, [e.documentId]: run } } : state;
}

/** Milliseconds from the first event to the end of the run (or to `now` while it runs). */
export function runDuration(run: RunTimeline, now = Date.now()): number {
  const end = run.endedAt ? Date.parse(run.endedAt) : now;
  return Math.max(0, end - Date.parse(run.startedAt));
}
