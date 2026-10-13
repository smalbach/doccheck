import { z } from 'zod';
import type { Destination, DocumentType } from './common';
import type { Finding, Severity } from './entities';

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

/**
 * A piece of the model's answer while it is written (ephemeral progress events: delivered live, never
 * stored). The text so far is the concatenation of the deltas; `offset` says where this one starts, so a
 * client that joined late or missed one can tell.
 */
export interface OutputDelta {
  /** Text written since the previous delta. */
  delta?: string;
  /** Position of `delta` in the whole answer (characters). */
  offset?: number;
  /** Tokens written so far (estimated when the answer is replayed from the cache). */
  tokens?: number;
  /** Writing speed so far. */
  tokensPerSecond?: number;
  /** The model starts over (a retry after an answer that did not match the schema): drop the text so far. */
  restart?: boolean;
  /** The text is a cached answer replayed, not the model writing. */
  replay?: boolean;
}

/**
 * A finding as live events show it before the run is saved: the stored finding's id (findings keep their
 * id when saved), severity and message (cut to FINDING_MESSAGE_CHARS so events stay small).
 */
export interface FindingPreview {
  id: string;
  severity: Severity;
  message: string;
}

/** Live events carry at most this many characters of a finding's message. */
export const FINDING_MESSAGE_CHARS = 200;
/** A rule's progress event lists at most this many of its findings (`findings` has the full count). */
export const FINDING_PREVIEWS_PER_RULE = 8;

/** Cuts text to `max` characters, ending with an ellipsis when it was longer. */
export const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** The preview of a finding, for a progress event. */
export const findingPreview = (f: Pick<Finding, 'id' | 'severity' | 'message'>): FindingPreview => ({ id: f.id, severity: f.severity, message: clip(f.message, FINDING_MESSAGE_CHARS) });

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
  /**
   * The model call. cached: the answer came from the model cache (replay, read-only demo).
   * Ephemeral progress events stream the answer as it is written (see `OutputDelta`).
   */
  extracting: { model?: string; documentType?: DocumentType; cached?: boolean; inputTokens?: number; outputTokens?: number } & OutputDelta;
  /** done: whether the values could be normalized, and how many issues were noted. */
  normalizing: { normalized?: boolean; issues?: number };
  /** done: the extraction is stored. */
  saved: { documentType?: DocumentType; normalized?: boolean; pages?: number };
}

/** Detail per validation stage. */
export interface ValidationDetail {
  /** The run began (status started only). runId is the id the stored validation will have. */
  started: { agent?: boolean; destination?: Destination };
  /**
   * started: how many documents the rules read. progress: one rule evaluated (index of total, skipped
   * when a document is missing), with the findings it produced (`found`, at most FINDING_PREVIEWS_PER_RULE;
   * `findings` is the count); done: the totals.
   */
  rules: { documents?: number; rule?: string; index?: number; total?: number; skipped?: number | boolean; ran?: number; findings?: number; found?: FindingPreview[] };
  /**
   * started: how many findings will be looked up. progress: one finding got a regulation quote (`findingId`,
   * `title` of the passage, cut to 120 chars). done: findings that got one; skipped (reason 'no-index').
   */
  citations: { findings?: number; findingId?: string; title?: string; citations?: number };
  /**
   * started: model and number of questions. progress: one question, without `answer` when it is asked
   * and with it once answered; `findingId` is the finding it is about (on the answer only for a finding the
   * agent `added`, whose preview comes in `added`). done: number of decisions. skipped (reason 'disabled').
   */
  agent: { model?: string; total?: number; index?: number; ruleId?: string; question?: string; findingId?: string; answer?: AgentAnswer; added?: FindingPreview; decisions?: number };
  /** done: the run is stored (validationId === runId). */
  saved: { validationId?: string; findings?: number; skipped?: number; agent?: 'done' | 'skipped' | 'failed' };
}

/** Error of an extraction the user cancelled (the document ends FAILED with it; `saved` fails with reason 'cancelled'). */
export const CANCELLED_ERROR = 'Cancelled by the user';

/** How long a stage usually takes on this server: median of `samples` recent runs (ms). */
export interface StageEstimate {
  ms: number;
  samples: number;
}

/**
 * Typical stage durations on this server, from recent progress events (GET /events/estimates), for an
 * activity panel to say "about 40 s left". A skipped stage counts as 0 ms. Clients decide how many
 * samples are enough.
 */
export interface ProgressEstimates {
  /** Model the next extraction will use (provider id, e.g. "ollama:qwen3.8"). */
  model: string;
  /** Per extraction stage; `reading` without OCR. */
  extraction: Partial<Record<ExtractionStage, StageEstimate>>;
  /** The model call (`extracting`) per model id. */
  models: Record<string, StageEstimate>;
  /** One page recognized by OCR. */
  ocrPage?: StageEstimate;
  /** Per validation stage (`agent`: the whole stage). */
  validation: Partial<Record<ValidationStage, StageEstimate>>;
  /** One agent question, asked and answered. */
  agentQuestion?: StageEstimate;
  /** ISO time the estimates were computed (they are cached for a minute). */
  computedAt: string;
}

/** Names the activity panel shows for runs (GET /events/labels): only the user's own shipments and documents. */
export interface ActivityLabels {
  shipments: { id: string; reference: string | null; destination: string | null }[];
  documents: { id: string; shipmentId: string; fileName: string; status: string }[];
}

/** One stage-level update, as packages report it: no ids, no time (the API adds them). */
export type UpdateOf<D> = {
  [S in keyof D & string]: { stage: S; status: ProgressStatus; durationMs?: number; detail?: D[S] & CommonDetail; ephemeral?: boolean };
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
  /**
   * Delivered live only, never stored nor replayed (the model's answer while it is written). Its `id` is
   * 0 and it is sent without an SSE `id:`, so it does not move a client's resume position.
   */
  ephemeral?: true;
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
  // 0 only for an ephemeral event (checked below).
  id: z.number().int().nonnegative(),
  shipmentId: z.string().uuid(),
  userId: z.string().uuid().nullable(),
  documentId: z.string().uuid().optional(),
  runId: z.string().uuid(),
  status: z.enum(PROGRESS_STATUSES),
  at: z.string().datetime({ offset: true }),
  durationMs: z.number().int().nonnegative().optional(),
  detail: z.record(z.string(), z.unknown()),
  ephemeral: z.literal(true).optional(),
});

/** Runtime check of an event's envelope (the stage must belong to the kind; detail is any object). */
export const ProgressEventSchema = z
  .discriminatedUnion('kind', [
    Base.extend({ kind: z.literal('extraction'), stage: z.enum(EXTRACTION_STAGES) }),
    Base.extend({ kind: z.literal('validation'), stage: z.enum(VALIDATION_STAGES) }),
  ])
  .refine((e) => (e.id === 0) === !!e.ephemeral, { message: 'id is 0 exactly for an ephemeral event', path: ['id'] });

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
  /** A step inside the stage; `ephemeral`: delivered live only, never stored (see EventBase.ephemeral). */
  progress(detail: D[S] & CommonDetail, opts?: { ephemeral?: boolean }): Promise<void>;
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
  const send = (status: ProgressStatus, d?: D[S] & CommonDetail, timed = false, ephemeral = false) =>
    report(onProgress, {
      stage,
      status,
      ...(timed ? { durationMs: Math.max(0, Math.round(now() - started)) } : {}),
      ...(d ? { detail: d } : {}),
      ...(ephemeral ? { ephemeral: true } : {}),
    } as UpdateOf<D>);
  await send('started', detail);
  const end = (status: ProgressStatus, d?: D[S] & CommonDetail) => {
    if (ended) return Promise.resolve();
    ended = true;
    return send(status, d, true);
  };
  return {
    progress: (d, opts) => (ended ? Promise.resolve() : send('progress', d, false, !!opts?.ephemeral)),
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
