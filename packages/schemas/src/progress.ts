import { z } from 'zod';
import type { Destination, DocumentType } from './common';

/**
 * Live progress events: what the API is doing while it extracts a document or validates a shipment.
 * The API stores each event in progress_events and streams it over SSE (docs/PROGRESS-EVENTS.md).
 * Packages report stage updates through an optional callback (`ProgressCallback`) and know nothing
 * about storage or delivery. The web imports the types only (no runtime code, no Zod in its bundle).
 */

export const PROGRESS_KINDS = ['extraction', 'validation'] as const;
export type ProgressKind = (typeof PROGRESS_KINDS)[number];

/** Extraction stages, in order. `ocr` only appears when a page had no text layer. */
export const EXTRACTION_STAGES = ['queued', 'reading', 'ocr', 'classifying', 'extracting', 'normalizing', 'saved'] as const;
export type ExtractionStage = (typeof EXTRACTION_STAGES)[number];

/** Validation stages, in order. */
export const VALIDATION_STAGES = ['started', 'rules', 'citations', 'agent', 'saved'] as const;
export type ValidationStage = (typeof VALIDATION_STAGES)[number];

/**
 * started: the stage began. progress: a step inside it (an OCR page, a rule, an agent question).
 * done / failed / skipped: the stage ended (done and failed carry durationMs).
 */
export const PROGRESS_STATUSES = ['started', 'progress', 'done', 'failed', 'skipped'] as const;
export type ProgressStatus = (typeof PROGRESS_STATUSES)[number];

/** Statuses that end a stage. */
export const STAGE_END: readonly ProgressStatus[] = ['done', 'failed', 'skipped'];

/** Fields the detail of any stage may carry. */
export interface CommonDetail {
  /** On failed: what went wrong, for people. */
  error?: string;
  /** On skipped (or a done that did nothing): why, machine-readable ('disabled', 'no-index', 'type-given'...). */
  reason?: string;
  /** On a failed extraction: the queue will run it again (same runId). */
  willRetry?: boolean;
}

/** The agent's answer to one question (validation stage `agent`, progress events). */
export interface AgentAnswer {
  verdict: 'yes' | 'no' | 'unsure';
  /** 0-1. */
  confidence: number;
  /** One or two sentences; may be cut to keep events small. */
  rationale?: string;
  /** What happened to the rule finding the question was about. */
  effect?: 'kept' | 'dismissed' | 'added' | 'none';
}

/** Detail per extraction stage. Every field is optional: a stage reports what it knows when it knows it. */
export interface ExtractionDetail {
  /** started: place in the queue (1 = next). */
  queued: { position?: number };
  /** done: page count. Reading includes OCR time when a page needed it. */
  reading: { pages?: number; ocrPages?: number[] };
  /** progress: PDF page being recognized (page of pages); done: tesseract's mean confidence (0-100). */
  ocr: { page?: number; pages?: number; ocrPages?: number; confidence?: number };
  /** done: the detected type; skipped (reason 'type-given'): the type the user chose. */
  classifying: { documentType?: DocumentType; confidence?: number };
  /** The model call. cached: the answer came from the model cache (replay, read-only demo). */
  extracting: { model?: string; documentType?: DocumentType; cached?: boolean; inputTokens?: number; outputTokens?: number };
  /** done: whether the values could be normalized, and how many issues were noted. */
  normalizing: { normalized?: boolean; issues?: number };
  /** done: the extraction is stored. */
  saved: { documentType?: DocumentType; normalized?: boolean; pages?: number };
}

/** Detail per validation stage. */
export interface ValidationDetail {
  /** The run began (status started only). runId is the id the stored validation will have. */
  started: { agent?: boolean; destination?: Destination };
  /** progress: one rule evaluated (index of total, skipped when a document is missing); done: the totals. */
  rules: { rule?: string; index?: number; total?: number; skipped?: number | boolean; ran?: number; findings?: number };
  /** done: findings that got a regulation quote; skipped (reason 'no-index'): no regulation index. */
  citations: { citations?: number };
  /**
   * started: model and number of questions. progress: one question, without `answer` when it is asked
   * and with it once answered. done: number of decisions. skipped (reason 'disabled'): agent turned off.
   */
  agent: { model?: string; total?: number; index?: number; ruleId?: string; question?: string; answer?: AgentAnswer; decisions?: number };
  /** done: the run is stored (validationId === runId). */
  saved: { validationId?: string; findings?: number; skipped?: number; agent?: 'done' | 'skipped' | 'failed' };
}

/** One stage-level update, as packages report it: no ids, no time (the API adds them). */
export type UpdateOf<D> = {
  [S in keyof D & string]: { stage: S; status: ProgressStatus; durationMs?: number; detail?: D[S] & CommonDetail };
}[keyof D & string];

export type ExtractionUpdate = UpdateOf<ExtractionDetail>;
export type ValidationUpdate = UpdateOf<ValidationDetail>;

/**
 * Optional progress hook of the pipeline functions. May return a promise, which is awaited (the
 * read-only demo paces stages this way); errors it throws or rejects with are ignored.
 */
export type ProgressCallback<D> = (update: UpdateOf<D>) => void | Promise<void>;

interface EventBase {
  /** Increasing (bigserial): order of storage, the SSE id, and what Last-Event-ID / ?after= refer to. */
  id: number;
  shipmentId: string;
  /** Owner of the shipment. */
  userId: string | null;
  /** Extraction events only. */
  documentId?: string;
  /**
   * Groups the events of one run: one extraction of a document (kept across queue retries), or one
   * validation (then equal to the stored validation's id).
   */
  runId: string;
  status: ProgressStatus;
  /** ISO timestamp, when the event happened. */
  at: string;
  /** On done and failed: time since the stage started. */
  durationMs?: number;
}

type EventOf<K extends ProgressKind, D> = {
  [S in keyof D & string]: EventBase & { kind: K; stage: S; detail: D[S] & CommonDetail };
}[keyof D & string];

export type ExtractionEvent = EventOf<'extraction', ExtractionDetail>;
export type ValidationEvent = EventOf<'validation', ValidationDetail>;
/** One stored event, as streamed over SSE (JSON in `data:`, `id:` = event.id). */
export type ProgressEvent = ExtractionEvent | ValidationEvent;

/** An event to publish: the API assigns id, userId and (unless given) at. */
export type NewProgressEvent = (Omit<ExtractionEvent, 'id' | 'userId' | 'at'> | Omit<ValidationEvent, 'id' | 'userId' | 'at'>) & { at?: string };

const Base = z.object({
  id: z.number().int().positive(),
  shipmentId: z.string().uuid(),
  userId: z.string().uuid().nullable(),
  documentId: z.string().uuid().optional(),
  runId: z.string().uuid(),
  status: z.enum(PROGRESS_STATUSES),
  at: z.string().datetime({ offset: true }),
  durationMs: z.number().int().nonnegative().optional(),
  detail: z.record(z.string(), z.unknown()),
});

/** Runtime check of an event's envelope (the stage must belong to the kind; detail is any object). */
export const ProgressEventSchema = z.discriminatedUnion('kind', [
  Base.extend({ kind: z.literal('extraction'), stage: z.enum(EXTRACTION_STAGES) }),
  Base.extend({ kind: z.literal('validation'), stage: z.enum(VALIDATION_STAGES) }),
]);

/** Calls the hook; never throws, so progress reporting cannot break the work it reports on. */
export async function report<D>(onProgress: ProgressCallback<D> | undefined, update: UpdateOf<D>): Promise<void> {
  if (!onProgress) return;
  try {
    await onProgress(update);
  } catch {
    // Ignored on purpose.
  }
}

/** A started stage: report steps inside it, then end it once (later calls to done/fail/skip are ignored). */
export interface StageHandle<D, S extends keyof D & string> {
  progress(detail: D[S] & CommonDetail): Promise<void>;
  done(detail?: D[S] & CommonDetail): Promise<void>;
  fail(error: unknown, detail?: D[S] & CommonDetail): Promise<void>;
  /** Ends the stage as skipped; say why in `reason`. */
  skip(detail: D[S] & CommonDetail): Promise<void>;
}

/** Message of anything thrown. */
export const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Reports `stage` started and returns a handle that times it. `now` is for tests. */
export async function startStage<D, S extends keyof D & string>(
  onProgress: ProgressCallback<D> | undefined,
  stage: S,
  detail?: D[S] & CommonDetail,
  now: () => number = Date.now,
): Promise<StageHandle<D, S>> {
  const started = now();
  let ended = false;
  const send = (status: ProgressStatus, d?: D[S] & CommonDetail, timed = false) =>
    report(onProgress, { stage, status, ...(timed ? { durationMs: Math.max(0, Math.round(now() - started)) } : {}), ...(d ? { detail: d } : {}) } as UpdateOf<D>);
  await send('started', detail);
  const end = (status: ProgressStatus, d?: D[S] & CommonDetail) => {
    if (ended) return Promise.resolve();
    ended = true;
    return send(status, d, true);
  };
  return {
    progress: (d) => (ended ? Promise.resolve() : send('progress', d)),
    done: (d) => end('done', d),
    fail: (err, d) => end('failed', { ...d, error: errorText(err) } as D[S] & CommonDetail),
    skip: (d) => end('skipped', d),
  };
}

/** Runs `work` inside a stage: done with what `describe` returns, or failed (and rethrown) on error. */
export async function withStage<D, S extends keyof D & string, T>(
  onProgress: ProgressCallback<D> | undefined,
  stage: S,
  work: (handle: StageHandle<D, S>) => Promise<T>,
  describe?: (result: T) => D[S] & CommonDetail,
  startDetail?: D[S] & CommonDetail,
): Promise<T> {
  const handle = await startStage(onProgress, stage, startDetail);
  try {
    const result = await work(handle);
    await handle.done(describe?.(result));
    return result;
  } catch (err) {
    await handle.fail(err);
    throw err;
  }
}
