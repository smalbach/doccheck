import type { OutputDelta } from '@doccheck/schemas';
import type { StreamChunk } from './llm';

/** At most one delta per this many ms while the model writes. */
export const STREAM_INTERVAL_MS = 300;
/**
 * Longest delta (characters). Deltas go out as NOTIFY payloads, which must stay under 8000 bytes, and
 * are never stored, so unlike a stored event they cannot fall back to being announced by id.
 */
export const MAX_DELTA_CHARS = 1500;

export interface OutputThrottleOptions {
  intervalMs?: number;
  maxChars?: number;
  /** For tests. */
  now?: () => number;
}

export interface OutputThrottle {
  /** One chunk from LlmClient.call's `onChunk`. Never throws, never blocks. */
  push(chunk: StreamChunk): void;
  /** Sends what is pending and waits until every delta was handed to `send`. Later pushes are ignored. */
  flush(): Promise<void>;
}

/**
 * Turns the model's chunks (one per token) into a few `OutputDelta`s: the first at once, then at most
 * one per interval, each at most `maxChars` long, sent in order (each `send` is awaited before the next).
 * Every delta carries the text written since the previous one, its offset, the token count so far and
 * the speed.
 */
export function throttleOutput(send: (delta: OutputDelta) => void | Promise<void>, { intervalMs = STREAM_INTERVAL_MS, maxChars = MAX_DELTA_CHARS, now = Date.now }: OutputThrottleOptions = {}): OutputThrottle {
  let pending = '';
  let offset = 0;
  let tokens = 0;
  let firstAt: number | undefined;
  let lastSent = -Infinity;
  let restart = false;
  let replay = false;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let chain: Promise<void> = Promise.resolve();

  const speed = (): number | undefined => {
    const seconds = firstAt === undefined ? 0 : (now() - firstAt) / 1000;
    return seconds >= 0.5 ? Math.round((tokens / seconds) * 10) / 10 : undefined;
  };

  const emit = () => {
    clearTimeout(timer);
    timer = undefined;
    if (!pending && !restart) return;
    const tokensPerSecond = speed();
    do {
      let cut = Math.min(pending.length, maxChars);
      // Never cut a surrogate pair in two.
      if (cut < pending.length && /[\uD800-\uDBFF]/.test(pending[cut - 1] ?? '')) cut -= 1;
      const delta: OutputDelta = {
        delta: pending.slice(0, cut),
        offset,
        tokens,
        ...(tokensPerSecond === undefined ? {} : { tokensPerSecond }),
        ...(restart ? { restart: true } : {}),
        ...(replay ? { replay: true } : {}),
      };
      pending = pending.slice(cut);
      offset += cut;
      restart = false;
      chain = chain.then(() => send(delta)).catch(() => undefined);
    } while (pending);
    lastSent = now();
  };

  return {
    push(chunk) {
      if (closed) return;
      if (chunk.restart) {
        // A retry: what was written is dropped, by the client too.
        pending = '';
        offset = 0;
        tokens = 0;
        firstAt = undefined;
        restart = true;
      }
      firstAt ??= now();
      pending += chunk.text;
      tokens += chunk.tokens;
      replay ||= !!chunk.replay;
      const since = now() - lastSent;
      if (pending.length >= maxChars || since >= intervalMs) emit();
      else timer ??= setTimeout(emit, intervalMs - since);
    },
    flush() {
      if (!closed) emit();
      closed = true;
      return chain;
    },
  };
}
