import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { leafLogprobs, type TokenLogprob } from './confidence';

/**
 * One structured call: system + user text in, an object matching `schema` out.
 * Providers only differ in transport; validation against the Zod schema happens in LlmClient.
 */
export interface StructuredRequest<S extends z.ZodType> {
  system: string;
  user: string;
  schema: S;
  /** Aborts the call (a cancelled extraction): the request to the model is dropped and the call rejects with the signal's reason. */
  signal?: AbortSignal;
  /** Sampling temperature (default 0). Part of the cache key when set. */
  temperature?: number;
  /** Ask for token log-probabilities (LLM_LOGPROBS=true), used as a confidence signal when complete. */
  logprobs?: boolean;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

/** A piece of the answer as the model writes it (LlmClient.call with `onChunk`). */
export interface StreamChunk {
  text: string;
  /** Tokens in `text`: 1 per model chunk, estimated for a replayed answer. */
  tokens: number;
  /** A retry begins: drop the text so far. */
  restart?: boolean;
  /** Replayed from the cache, not written by the model. */
  replay?: boolean;
}

export interface CallOptions {
  /**
   * Streams the answer while it is written. A cache hit is replayed in chunks (paced by
   * LlmClient.replayMs), so callers see the same stream either way. Without it nothing streams.
   */
  onChunk?: (chunk: StreamChunk) => void;
}

export interface GenerateOptions {
  /** Each piece of text the model writes, in order. A provider that cannot stream may never call it. */
  onText?: (text: string) => void;
}

export interface LlmProvider {
  /** "ollama:qwen3.8" - part of the cache key. */
  readonly id: string;
  generate(req: StructuredRequest<z.ZodType>, opts?: GenerateOptions): Promise<{ output: unknown; usage?: Usage; content?: string; logprobs?: TokenLogprob[] }>;
  /** Exact model build (e.g. the Ollama digest), recorded with results: a tag like "latest" can change under you. */
  version?(): Promise<string | undefined>;
}

export class LlmError extends Error {}

/** What /api/chat sends: the whole answer, or (streaming) one line per piece, the last with done and counts. */
interface OllamaChatBody {
  message?: { content?: string };
  done?: boolean;
  error?: string;
  prompt_eval_count?: number;
  eval_count?: number;
  logprobs?: TokenLogprob[];
}

/** Parses a newline-delimited JSON body (Ollama's stream) line by line, whatever the chunk boundaries. */
export async function* readNdjson<T>(body: ReadableStream<Uint8Array>): AsyncGenerator<T> {
  const decoder = new TextDecoder();
  let buffer = '';
  const parse = (line: string): T => {
    try {
      return JSON.parse(line) as T;
    } catch {
      throw new LlmError('Ollama sent an unreadable stream line');
    }
  };
  for await (const bytes of body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(bytes, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) yield parse(line);
    }
  }
  const rest = (buffer + decoder.decode()).trim();
  if (rest) yield parse(rest);
}

/** Local models through Ollama's /api/chat with a JSON schema in `format`. */
export class OllamaProvider implements LlmProvider {
  readonly id: string;

  constructor(
    private readonly model = 'qwen3.8',
    private readonly baseUrl = 'http://localhost:11434',
  ) {
    this.id = `ollama:${model}`;
  }

  private digest?: Promise<string | undefined>;

  version() {
    this.digest ??= fetch(`${this.baseUrl}/api/tags`)
      .then((r) => r.json() as Promise<{ models: { name: string; digest: string }[] }>)
      .then(({ models }) => models.find((m) => m.name === this.model || m.name === `${this.model}:latest`)?.digest.slice(0, 12))
      .catch(() => undefined);
    return this.digest;
  }

  /** Streams (stream: true) only when `onText` is given; the result is the same either way. */
  async generate(req: StructuredRequest<z.ZodType>, opts: GenerateOptions = {}) {
    const stream = !!opts.onText;
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        signal: req.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          stream,
          think: false,
          format: z.toJSONSchema(req.schema),
          ...(req.logprobs ? { logprobs: true } : {}),
          options: { temperature: req.temperature ?? 0, num_ctx: 16384 },
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: req.user },
          ],
        }),
      });
    } catch (err) {
      req.signal?.throwIfAborted();
      throw new LlmError(`Ollama is not reachable at ${this.baseUrl} (${err instanceof Error ? err.message : String(err)})`);
    }
    if (!res.ok) throw new LlmError(`Ollama ${res.status}: ${await res.text()}`);
    try {
      return await this.readAnswer(res, stream, req.signal, opts);
    } catch (err) {
      // Aborting the fetch also errors its body mid-read: report the cancellation, not a read error.
      req.signal?.throwIfAborted();
      throw err;
    }
  }

  private async readAnswer(res: Response, stream: boolean, signal: AbortSignal | undefined, opts: GenerateOptions) {
    let body: OllamaChatBody;
    if (stream && res.body) {
      let content = '';
      let last: OllamaChatBody = {};
      const logprobs: TokenLogprob[] = [];
      for await (const line of readNdjson<OllamaChatBody>(res.body)) {
        signal?.throwIfAborted();
        if (line.error) throw new LlmError(`Ollama: ${line.error}`);
        for (const t of line.logprobs ?? []) logprobs.push({ token: t.token, logprob: t.logprob });
        const piece = line.message?.content ?? '';
        if (piece) {
          content += piece;
          try {
            opts.onText?.(piece);
          } catch {
            // A listener never breaks the call.
          }
        }
        last = line;
      }
      signal?.throwIfAborted();
      body = { ...last, message: { content }, logprobs };
    } else {
      body = (await res.json()) as OllamaChatBody;
    }
    let output: unknown;
    try {
      output = JSON.parse(body.message?.content ?? '');
    } catch {
      throw new LlmError('Ollama returned invalid JSON');
    }
    const content = body.message?.content ?? '';
    const logprobs = body.logprobs?.map((t) => ({ token: t.token, logprob: t.logprob }));
    return { output, content, ...(logprobs?.length ? { logprobs } : {}), usage: { inputTokens: body.prompt_eval_count ?? 0, outputTokens: body.eval_count ?? 0 } };
  }
}

export type CacheMode = 'off' | 'readwrite' | 'replay';

/** One model call, for tracing (the API stores these in Postgres). */
export interface LlmTrace {
  provider: string;
  promptVersion: string;
  key: string;
  cached: boolean;
  ms: number;
  usage?: Usage;
  error?: string;
  modelVersion?: string;
}

export interface CallResult<T> {
  output: T;
  usage?: Usage;
  cached: boolean;
  /** Lowest token log-probability per answer field ("lines[0].quantity"), when the provider gave every token's. */
  logprobs?: Record<string, number>;
}

/**
 * Validates provider output against the schema (one retry with the validation errors) and
 * records every response on disk. In "replay" mode a cache miss is an error, so the evaluation
 * can run in CI with no model and no cost.
 */
export class LlmClient {
  /** Called after every call, cached or not. Errors thrown by the tracer are ignored. */
  tracer?: (trace: LlmTrace) => void | Promise<void>;
  /**
   * How long replaying a cached answer as a stream takes (ms). 0 (default): at once. The read-only
   * demo sets it so visitors see the answer being written.
   */
  replayMs = 0;

  constructor(
    readonly provider: LlmProvider,
    private readonly cacheDir?: string,
    private readonly mode: CacheMode = cacheDir ? 'readwrite' : 'off',
  ) {}

  cacheKey(promptVersion: string, req: Pick<StructuredRequest<z.ZodType>, 'system' | 'user' | 'temperature'>): string {
    // The temperature joins the key only when set, so every answer cached before it existed still matches.
    const parts: unknown[] = [this.provider.id, promptVersion, req.system, req.user];
    if (req.temperature !== undefined) parts.push(req.temperature);
    return createHash('sha256')
      .update(JSON.stringify(parts))
      .digest('hex')
      .slice(0, 32);
  }

  /** Whether a valid cached response exists for this request (no model call). */
  async isCached<S extends z.ZodType>(promptVersion: string, req: StructuredRequest<S>): Promise<boolean> {
    if (!this.cacheDir) return false;
    const hit = await readFile(join(this.cacheDir, `${this.cacheKey(promptVersion, req)}.json`), 'utf8').then(JSON.parse, () => undefined);
    return !!hit && req.schema.safeParse(hit.output).success;
  }

  /** The model's answer, checked against the schema; `opts.onChunk` streams it (see CallOptions). */
  async call<S extends z.ZodType>(promptVersion: string, req: StructuredRequest<S>, opts: CallOptions = {}): Promise<CallResult<z.infer<S>>> {
    const started = Date.now();
    const key = this.cacheKey(promptVersion, req);
    const trace = (t: Partial<LlmTrace>) =>
      Promise.resolve(this.provider.version?.())
        .then((modelVersion) => this.tracer?.({ provider: this.provider.id, promptVersion, key, cached: false, ms: Date.now() - started, modelVersion, ...t }))
        .catch(() => undefined);
    try {
      const result = await this.callUncached(key, promptVersion, req, opts.onChunk && safe(opts.onChunk));
      await trace({ cached: result.cached, usage: result.usage });
      return result;
    } catch (err) {
      await trace({ error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  private async callUncached<S extends z.ZodType>(
    key: string,
    promptVersion: string,
    req: StructuredRequest<S>,
    onChunk?: (chunk: StreamChunk) => void,
  ): Promise<CallResult<z.infer<S>>> {
    const file = this.cacheDir ? join(this.cacheDir, `${key}.json`) : undefined;

    if (file && this.mode !== 'off') {
      const hit = await readFile(file, 'utf8').then(JSON.parse, () => undefined);
      if (hit) {
        const parsed = req.schema.safeParse(hit.output);
        if (parsed.success) {
          if (onChunk) await replayAsStream(parsed.data, hit.usage, onChunk, this.replayMs, req.signal);
          return { output: parsed.data, usage: hit.usage, cached: true, ...(hit.logprobs ? { logprobs: hit.logprobs } : {}) };
        }
      }
      if (this.mode === 'replay') throw new LlmError(`Cache miss in replay mode (${this.provider.id}, key ${key})`);
    }

    const generateOpts: GenerateOptions | undefined = onChunk && { onText: (text) => onChunk({ text, tokens: 1 }) };
    req.signal?.throwIfAborted();
    let { output, usage, content, logprobs: tokens } = await this.provider.generate(req, generateOpts);
    let parsed = req.schema.safeParse(output);
    if (!parsed.success) {
      req.signal?.throwIfAborted();
      onChunk?.({ text: '', tokens: 0, restart: true });
      const retry = await this.provider.generate(
        {
          ...req,
          user: `${req.user}\n\nYour previous answer did not match the schema:\n${z.prettifyError(parsed.error)}\nReturn the corrected JSON.`,
        },
        generateOpts,
      );
      output = retry.output;
      content = retry.content;
      tokens = retry.logprobs;
      usage = retry.usage && usage ? { inputTokens: usage.inputTokens + retry.usage.inputTokens, outputTokens: usage.outputTokens + retry.usage.outputTokens } : retry.usage;
      parsed = req.schema.safeParse(output);
      if (!parsed.success) throw new LlmError(`Output does not match the schema: ${z.prettifyError(parsed.error)}`);
    }

    // A cancelled call never leaves an answer in the cache, even one that completed just as it was aborted.
    req.signal?.throwIfAborted();
    const logprobs = content !== undefined ? leafLogprobs(content, tokens) : undefined;
    if (file && this.mode !== 'off') {
      await mkdir(this.cacheDir!, { recursive: true });
      const modelVersion = await this.provider.version?.();
      await writeFile(file, JSON.stringify({ provider: this.provider.id, modelVersion, promptVersion, usage, output: parsed.data, ...(logprobs ? { logprobs } : {}) }, null, 2) + '\n');
    }
    return { output: parsed.data, usage, cached: false, ...(logprobs ? { logprobs } : {}) };
  }
}

/** A listener that cannot throw into the call. */
const safe =
  (fn: (chunk: StreamChunk) => void) =>
  (chunk: StreamChunk): void => {
    try {
      fn(chunk);
    } catch {
      // Ignored: streaming is a view on the call, never a reason for it to fail.
    }
  };

/** Waits `ms`; an aborted signal ends the wait at once (the caller checks the signal after). */
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });

/** Characters per replayed chunk when it is not paced. */
const REPLAY_CHUNK_CHARS = 256;
/** Time between replayed chunks when it is paced. */
const REPLAY_TICK_MS = 40;

/**
 * Plays a cached answer back as a stream: its JSON (indented, as people read it) in chunks, with the
 * cached output token count spread over them. `totalMs` spreads it over that long; 0 sends it at once.
 * An aborted `signal` stops the replay: no chunk is sent after it, and the call rejects with its reason.
 */
export async function replayAsStream(
  output: unknown,
  usage: Usage | undefined,
  onChunk: (chunk: StreamChunk) => void,
  totalMs = 0,
  signal?: AbortSignal,
): Promise<void> {
  const text = JSON.stringify(output, null, 2) ?? '';
  if (!text) return;
  const count = totalMs > 0 ? Math.max(1, Math.min(text.length, Math.round(totalMs / REPLAY_TICK_MS))) : Math.ceil(text.length / REPLAY_CHUNK_CHARS);
  const totalTokens = usage?.outputTokens || Math.ceil(text.length / 4);
  let sentTokens = 0;
  let from = 0;
  for (let i = 0; i < count && from < text.length; i++) {
    let to = Math.round(((i + 1) * text.length) / count);
    // Never cut a surrogate pair in two.
    if (to < text.length && /[\uD800-\uDBFF]/.test(text[to - 1] ?? '')) to += 1;
    // Cumulative rounding: the chunks add up to the cached token count exactly.
    const tokens = Math.round((to * totalTokens) / text.length) - sentTokens;
    sentTokens += tokens;
    if (totalMs > 0 && i > 0) await sleep(totalMs / count, signal);
    signal?.throwIfAborted();
    onChunk({ text: text.slice(from, to), tokens, replay: true });
    from = to;
  }
}
