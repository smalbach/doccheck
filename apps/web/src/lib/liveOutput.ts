import type { ProgressEvent } from '../api/types';
import type { RunTimeline } from './progressTimeline';

/**
 * The model's answer for one document while it is written, from the ephemeral `extracting` events
 * (docs/PROGRESS-EVENTS.md). Never stored: a page opened mid-stream starts from the next delta.
 */
export interface LiveOutput {
  runId: string;
  /** Text received so far. */
  text: string;
  /** Where `text` starts in the whole answer: above 0 when the beginning was missed. */
  start: number;
  /** Tokens written so far. */
  tokens: number;
  tokensPerSecond?: number;
  /** A cached answer replayed, not the model writing. */
  replay: boolean;
}

/** The output with one more ephemeral event applied. Pure; a delta applied twice changes nothing. */
export function applyOutput(prev: LiveOutput | undefined, e: ProgressEvent): LiveOutput | undefined {
  if (!e.ephemeral || e.kind !== 'extraction' || e.stage !== 'extracting') return prev;
  const { delta = '', offset = 0, tokens, tokensPerSecond, restart, replay } = e.detail;
  const base = prev && prev.runId === e.runId && !restart ? prev : undefined;
  let text = delta;
  let start = offset;
  if (base) {
    const end = base.start + base.text.length;
    // Already applied (its stats are older too).
    if (offset + delta.length <= end && offset >= base.start && !(delta === '' && offset === end)) return base;
    if (offset <= end) {
      // Contiguous, or overlapping a delta already applied: keep only what is new.
      text = base.text + delta.slice(end - offset);
      start = base.start;
    }
    // offset > end: a delta was missed (ephemeral events are not replayed); start again from here.
  }
  return {
    runId: e.runId,
    text,
    start,
    tokens: tokens ?? base?.tokens ?? 0,
    tokensPerSecond: tokensPerSecond ?? base?.tokensPerSecond,
    replay: !!replay || !!base?.replay,
  };
}

/**
 * The last string value fully written in a JSON text that may be cut anywhere: a string followed by
 * `,` `}` or `]` (a string followed by `:` is a key). What the model "just read", to point at in the PDF.
 */
export function lastCompletedValue(text: string): string | undefined {
  let last: string | undefined;
  let pending: string | undefined;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      if (j >= text.length) break;
      try {
        pending = JSON.parse(text.slice(i, j + 1)) as string;
      } catch {
        pending = undefined;
      }
      i = j;
      continue;
    }
    if (pending !== undefined && !/\s/.test(ch)) {
      if (ch !== ':') last = pending;
      pending = undefined;
    }
  }
  return last;
}

/** The text the model is writing for this run right now: undefined once its `extracting` stage ended. */
export function textBeingWritten(run: RunTimeline | undefined, output: LiveOutput | undefined): string | undefined {
  const status = run?.steps.extracting?.status;
  return output && run?.runId === output.runId && (status === 'started' || status === 'progress') ? output.text : undefined;
}
