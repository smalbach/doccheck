import type { ProgressEstimates, ProgressEvent, StageEstimate } from '../api/types';
import type { MessageKey, MessageVars } from '../i18n/keys';
import { applyToRun, type RunTimeline, type StepState } from './progressTimeline';

/** One run in the activity panel: an extraction of a document or a validation, of one of the user's shipments. */
export interface ActivityRun {
  shipmentId: string;
  timeline: RunTimeline;
}

/** Every run the user-wide stream reported (running ones, and the latest finished ones), by run id. */
export interface ActivityState {
  runs: Readonly<Record<string, ActivityRun>>;
}

export const EMPTY_ACTIVITY: ActivityState = { runs: {} };

/** Names of the user's shipments and documents, as far as they are known (GET /events/labels). */
export interface ActivityNames {
  shipments: Readonly<Record<string, { reference: string | null; destination: string | null }>>;
  documents: Readonly<Record<string, { fileName: string; status: string }>>;
}

/** The shipment's reference (or the start of its id) and, for an extraction, the file: "CA-014 · invoice.pdf". */
export function runName(run: ActivityRun, names: ActivityNames): { shipment: string; file?: string; full: string } {
  const shipment = names.shipments[run.shipmentId]?.reference || run.shipmentId.slice(0, 8);
  const file = run.timeline.documentId ? names.documents[run.timeline.documentId]?.fileName : undefined;
  return { shipment, file, full: file ? `${shipment} · ${file}` : shipment };
}

/** Finished runs kept (and listed) once they end. */
export const KEEP_FINISHED = 10;
/** An estimate needs at least this many past runs of the stage. */
export const MIN_SAMPLES = 3;
/**
 * A step running longer than usual by more than this factor (plus a margin) has no estimate left:
 * something is slow, and "a few seconds left" would be a guess.
 */
const OVERDUE_FACTOR = 1.25;
const OVERDUE_MARGIN_MS = 5000;
/** Longer estimates are not shown (nothing in the app takes that long when it works). */
const MAX_ESTIMATE_MS = 60 * 60 * 1000;

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const ended = (step: StepState | undefined) => !!step && (step.status === 'done' || step.status === 'failed' || step.status === 'skipped');
const endedAtMs = (run: ActivityRun) => (run.timeline.endedAt ? Date.parse(run.timeline.endedAt) : 0);

/** The state with one more event of the user-wide stream. Pure and idempotent; old finished runs are dropped. */
export function applyActivityEvent(state: ActivityState, e: ProgressEvent): ActivityState {
  const prev = state.runs[e.runId];
  const timeline = applyToRun(prev?.timeline, e);
  if (!timeline || timeline === prev?.timeline) return state;
  const runs: Record<string, ActivityRun> = { ...state.runs, [e.runId]: { shipmentId: e.shipmentId, timeline } };
  const finished = Object.entries(runs)
    .filter(([, r]) => r.timeline.state !== 'running')
    .sort(([, a], [, b]) => endedAtMs(b) - endedAtMs(a) || b.timeline.lastId - a.timeline.lastId);
  for (const [runId] of finished.slice(KEEP_FINISHED)) delete runs[runId];
  return { runs };
}

/** Order of running runs: working ones first, then by when they started, then by place in line. */
function byProgress(a: ActivityRun, b: ActivityRun): number {
  const queued = Number(isQueued(a.timeline)) - Number(isQueued(b.timeline));
  const position = (r: ActivityRun) => num(r.timeline.steps.queued?.detail.position) ?? 0;
  return queued || Date.parse(a.timeline.startedAt) - Date.parse(b.timeline.startedAt) || position(a) - position(b) || a.timeline.runId.localeCompare(b.timeline.runId);
}

/** Running runs (working ones first, oldest first) and finished ones (latest first). */
export function splitActivity(state: ActivityState): { running: ActivityRun[]; finished: ActivityRun[] } {
  const all = Object.values(state.runs);
  return {
    running: all.filter((r) => r.timeline.state === 'running').sort(byProgress),
    finished: all
      .filter((r) => r.timeline.state !== 'running')
      .sort((a, b) => endedAtMs(b) - endedAtMs(a) || b.timeline.lastId - a.timeline.lastId)
      .slice(0, KEEP_FINISHED),
  };
}

/** Whether the run is an extraction still waiting in line. */
export const isQueued = (run: RunTimeline): boolean => run.kind === 'extraction' && run.state === 'running' && run.steps.queued?.status === 'started';

/**
 * Place in line of a queued extraction: the position it got when queued, minus the user's runs queued
 * before it that have left the line since. Other users' jobs are not seen, so this is an upper bound.
 */
export function queuePosition(run: ActivityRun, runs: readonly ActivityRun[]): number | undefined {
  const queued = run.timeline.steps.queued;
  const position = num(queued?.detail.position);
  if (!isQueued(run.timeline) || !queued?.startedAt || position === undefined) return undefined;
  const since = Date.parse(queued.startedAt);
  const left = runs.filter((o) => {
    const q = o.timeline.steps.queued;
    if (o === run || o.timeline.kind !== 'extraction' || !q?.startedAt || !ended(q)) return false;
    return Date.parse(q.startedAt) <= since && (q.endedAt ? Date.parse(q.endedAt) >= since : true);
  }).length;
  return Math.max(1, position - left);
}

/** What a running run is doing now, for "Extracting with the model (28 s)": a message and when that step started. */
export interface ActivityDoing {
  key: MessageKey;
  vars?: MessageVars;
  /** ISO start of the current step, for the elapsed time. */
  since?: string;
}

/** The step a run is in: the last one started and not ended (by stage order). */
function currentStage(run: RunTimeline, order: readonly string[]): string | undefined {
  return [...order].reverse().find((s) => {
    const step = run.steps[s];
    return step && !ended(step);
  });
}

const EXTRACTION_ORDER = ['queued', 'reading', 'ocr', 'classifying', 'extracting', 'normalizing', 'saved'] as const;
const VALIDATION_ORDER = ['started', 'rules', 'citations', 'agent', 'saved'] as const;

export function activityDoing(run: RunTimeline, position?: number): ActivityDoing {
  if (run.kind === 'extraction') {
    const stage = currentStage(run, EXTRACTION_ORDER);
    const step = stage ? run.steps[stage] : undefined;
    const since = step?.startedAt;
    const d = step?.detail ?? {};
    switch (stage) {
      case 'queued':
        return position ? { key: 'activity.doing.queuedAt', vars: { position }, since } : { key: 'activity.doing.queued', since };
      case 'reading':
        return { key: 'activity.doing.reading', since };
      case 'ocr':
        return num(d.page) && num(d.pages) ? { key: 'activity.doing.ocrPage', vars: { page: num(d.page)!, pages: num(d.pages)! }, since } : { key: 'activity.doing.ocr', since };
      case 'classifying':
        return { key: 'activity.doing.classifying', since };
      case 'extracting':
        return { key: 'activity.doing.extracting', since };
      case 'normalizing':
        return { key: 'activity.doing.normalizing', since };
      case 'saved':
        return { key: 'activity.doing.saving', since };
      default:
        return { key: 'activity.doing.working' };
    }
  }
  const stage = currentStage(run, VALIDATION_ORDER.filter((s) => s !== 'started'));
  const step = stage ? run.steps[stage] : undefined;
  const since = step?.startedAt;
  switch (stage) {
    case 'rules': {
      const index = num(step?.detail.index);
      const total = num(step?.detail.total);
      return index !== undefined && total !== undefined ? { key: 'activity.doing.rulesCount', vars: { index, total }, since } : { key: 'activity.doing.rules', since };
    }
    case 'citations':
      return { key: 'activity.doing.citations', since };
    case 'agent': {
      const total = num(step?.detail.total) ?? run.questions[0]?.total;
      const asked = run.questions.length;
      return total && asked ? { key: 'activity.doing.agentQuestion', vars: { index: asked, total }, since } : { key: 'activity.doing.agent', since };
    }
    case 'saved':
      return { key: 'activity.doing.saving', since };
    default:
      return { key: 'activity.doing.validating', since: run.startedAt };
  }
}

/** How a finished run ended, for the "recently finished" list. */
export interface ActivityOutcome {
  tone: 'ok' | 'failed' | 'cancelled';
  key: MessageKey;
  vars?: MessageVars;
  /** Milliseconds to format into vars.duration. */
  durationMs?: number;
}

export function activityOutcome(run: RunTimeline, durationMs: number): ActivityOutcome {
  const saved = run.steps.saved;
  if (run.state === 'done') {
    if (run.kind === 'validation') return { tone: 'ok', key: 'activity.outcome.validated', vars: { count: num(saved?.detail.findings) ?? 0 }, durationMs };
    return { tone: 'ok', key: 'activity.outcome.extracted', durationMs };
  }
  if (str(saved?.detail.reason) === 'cancelled') return { tone: 'cancelled', key: 'activity.outcome.cancelled' };
  const error = saved?.error ?? str(saved?.detail.error);
  return error ? { tone: 'failed', key: 'activity.outcome.failedWith', vars: { error } } : { tone: 'failed', key: 'activity.outcome.failed' };
}

const enough = (e: StageEstimate | undefined): e is StageEstimate => !!e && e.samples >= MIN_SAMPLES;

/**
 * Milliseconds left for a running run, from the server's typical stage durations, or undefined when
 * it cannot be told: a queued extraction (it depends on the line), too little history for a stage
 * still ahead, a step running well past its usual time, or an absurd total. Never negative.
 */
export function remainingMs(run: RunTimeline, estimates: ProgressEstimates | undefined, now: number): number | undefined {
  if (!estimates || run.state !== 'running') return undefined;
  const parts = run.kind === 'extraction' ? extractionParts(run, estimates) : validationParts(run, estimates);
  if (!parts) return undefined;
  let total = 0;
  for (const p of parts) {
    if (!p.since) {
      total += p.ms;
      continue;
    }
    const elapsed = Math.max(0, now - Date.parse(p.since));
    if (elapsed > p.ms * OVERDUE_FACTOR + OVERDUE_MARGIN_MS) return undefined;
    total += Math.max(0, p.ms - elapsed);
  }
  return total > MAX_ESTIMATE_MS ? undefined : Math.round(total);
}

/** What is left of a run: the typical time of each step still ahead, `since` set on the one running. */
interface Part {
  ms: number;
  since?: string;
}

function extractionParts(run: RunTimeline, est: ProgressEstimates): Part[] | undefined {
  if (isQueued(run)) return undefined;
  const parts: Part[] = [];
  const ocr = run.steps.ocr;
  for (const stage of ['reading', 'classifying', 'extracting', 'normalizing', 'saved'] as const) {
    const step = run.steps[stage];
    if (ended(step)) continue;
    if (stage === 'reading' && ocr && !ended(ocr)) {
      // A scan: OCR time per page instead of the usual reading time.
      const pages = num(ocr.detail.pages);
      if (!enough(est.ocrPage) || !pages) return undefined;
      parts.push({ ms: est.ocrPage.ms * pages, since: ocr.startedAt });
      continue;
    }
    const model = stage === 'extracting' ? (str(step?.detail.model) ?? est.model) : undefined;
    const e = model ? est.models[model] : est.extraction[stage];
    if (!enough(e)) return undefined;
    parts.push({ ms: e.ms, since: step?.startedAt });
  }
  return parts;
}

function validationParts(run: RunTimeline, est: ProgressEstimates): Part[] | undefined {
  const parts: Part[] = [];
  const agentOff = run.steps.started?.detail.agent === false;
  for (const stage of ['rules', 'citations', 'agent', 'saved'] as const) {
    const step = run.steps[stage];
    if (ended(step) || (stage === 'agent' && agentOff)) continue;
    if (stage === 'agent' && step) {
      // Questions left at the usual time per question, the current one counted from when it was asked.
      const total = num(step.detail.total) ?? 0;
      const answered = run.questions.filter((q) => q.answer).length;
      if (!total) continue;
      if (!enough(est.agentQuestion)) return undefined;
      parts.push({ ms: est.agentQuestion.ms * Math.max(0, total - answered) });
      continue;
    }
    const e = est.validation[stage];
    if (!enough(e)) return undefined;
    parts.push({ ms: e.ms, since: step?.startedAt });
  }
  return parts;
}
