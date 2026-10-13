import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

/**
 * One structured call: system + user text in, an object matching `schema` out.
 * Providers only differ in transport; validation against the Zod schema happens in LlmClient.
 */
export interface StructuredRequest<S extends z.ZodType> {
  system: string;
  user: string;
  schema: S;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface LlmProvider {
  /** "ollama:qwen3.8" - part of the cache key. */
  readonly id: string;
  generate(req: StructuredRequest<z.ZodType>): Promise<{ output: unknown; usage?: Usage }>;
  /** Exact model build (e.g. the Ollama digest), recorded with results: a tag like "latest" can change under you. */
  version?(): Promise<string | undefined>;
}

export class LlmError extends Error {}

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

  async generate(req: StructuredRequest<z.ZodType>) {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          stream: false,
          think: false,
          format: z.toJSONSchema(req.schema),
          options: { temperature: 0, num_ctx: 16384 },
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: req.user },
          ],
        }),
      });
    } catch (err) {
      throw new LlmError(`Ollama is not reachable at ${this.baseUrl} (${err instanceof Error ? err.message : String(err)})`);
    }
    if (!res.ok) throw new LlmError(`Ollama ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { message?: { content?: string }; prompt_eval_count?: number; eval_count?: number };
    let output: unknown;
    try {
      output = JSON.parse(body.message?.content ?? '');
    } catch {
      throw new LlmError('Ollama returned invalid JSON');
    }
    return { output, usage: { inputTokens: body.prompt_eval_count ?? 0, outputTokens: body.eval_count ?? 0 } };
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
}

/**
 * Validates provider output against the schema (one retry with the validation errors) and
 * records every response on disk. In "replay" mode a cache miss is an error, so the evaluation
 * can run in CI with no model and no cost.
 */
export class LlmClient {
  /** Called after every call, cached or not. Errors thrown by the tracer are ignored. */
  tracer?: (trace: LlmTrace) => void | Promise<void>;

  constructor(
    readonly provider: LlmProvider,
    private readonly cacheDir?: string,
    private readonly mode: CacheMode = cacheDir ? 'readwrite' : 'off',
  ) {}

  cacheKey(promptVersion: string, req: Pick<StructuredRequest<z.ZodType>, 'system' | 'user'>): string {
    return createHash('sha256')
      .update(JSON.stringify([this.provider.id, promptVersion, req.system, req.user]))
      .digest('hex')
      .slice(0, 32);
  }

  /** Whether a valid cached response exists for this request (no model call). */
  async isCached<S extends z.ZodType>(promptVersion: string, req: StructuredRequest<S>): Promise<boolean> {
    if (!this.cacheDir) return false;
    const hit = await readFile(join(this.cacheDir, `${this.cacheKey(promptVersion, req)}.json`), 'utf8').then(JSON.parse, () => undefined);
    return !!hit && req.schema.safeParse(hit.output).success;
  }

  async call<S extends z.ZodType>(promptVersion: string, req: StructuredRequest<S>): Promise<CallResult<z.infer<S>>> {
    const started = Date.now();
    const key = this.cacheKey(promptVersion, req);
    const trace = (t: Partial<LlmTrace>) =>
      Promise.resolve(this.provider.version?.())
        .then((modelVersion) => this.tracer?.({ provider: this.provider.id, promptVersion, key, cached: false, ms: Date.now() - started, modelVersion, ...t }))
        .catch(() => undefined);
    try {
      const result = await this.callUncached(key, promptVersion, req);
      await trace({ cached: result.cached, usage: result.usage });
      return result;
    } catch (err) {
      await trace({ error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  private async callUncached<S extends z.ZodType>(key: string, promptVersion: string, req: StructuredRequest<S>): Promise<CallResult<z.infer<S>>> {
    const file = this.cacheDir ? join(this.cacheDir, `${key}.json`) : undefined;

    if (file && this.mode !== 'off') {
      const hit = await readFile(file, 'utf8').then(JSON.parse, () => undefined);
      if (hit) {
        const parsed = req.schema.safeParse(hit.output);
        if (parsed.success) return { output: parsed.data, usage: hit.usage, cached: true };
      }
      if (this.mode === 'replay') throw new LlmError(`Cache miss in replay mode (${this.provider.id}, key ${key})`);
    }

    let { output, usage } = await this.provider.generate(req);
    let parsed = req.schema.safeParse(output);
    if (!parsed.success) {
      const retry = await this.provider.generate({
        ...req,
        user: `${req.user}\n\nYour previous answer did not match the schema:\n${z.prettifyError(parsed.error)}\nReturn the corrected JSON.`,
      });
      output = retry.output;
      usage = retry.usage && usage ? { inputTokens: usage.inputTokens + retry.usage.inputTokens, outputTokens: usage.outputTokens + retry.usage.outputTokens } : retry.usage;
      parsed = req.schema.safeParse(output);
      if (!parsed.success) throw new LlmError(`Output does not match the schema: ${z.prettifyError(parsed.error)}`);
    }

    if (file && this.mode !== 'off') {
      await mkdir(this.cacheDir!, { recursive: true });
      const modelVersion = await this.provider.version?.();
      await writeFile(file, JSON.stringify({ provider: this.provider.id, modelVersion, promptVersion, usage, output: parsed.data }, null, 2) + '\n');
    }
    return { output: parsed.data, usage, cached: false };
  }
}

/**
 * Local models only, through Ollama. LLM_MODEL (default qwen3.8), OLLAMA_BASE_URL,
 * LLM_CACHE_DIR, LLM_CACHE_MODE=off|readwrite|replay.
 */
export function llmFromEnv(env: NodeJS.ProcessEnv = process.env): LlmClient {
  const provider = new OllamaProvider(env.LLM_MODEL || undefined, env.OLLAMA_BASE_URL || undefined);
  return new LlmClient(provider, env.LLM_CACHE_DIR || undefined, (env.LLM_CACHE_MODE as CacheMode) || undefined);
}
