import { assertAiAllowed } from '@doccheck/schemas';
import { z } from 'zod';
import type { TokenLogprob } from './confidence';
import { LlmClient, LlmError, OllamaProvider, type CacheMode, type GenerateOptions, type LlmProvider, type StructuredRequest, type Usage } from './llm';

type Answer = Awaited<ReturnType<LlmProvider['generate']>>;

/** The schema as plain JSON Schema (no "$schema" line: some APIs reject it). */
function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _drop, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest;
}

/** Server-sent events: the JSON of each `data:` line, whatever the chunk boundaries ("[DONE]" ends it). */
export async function* readSse<T>(body: ReadableStream<Uint8Array>, who: string): AsyncGenerator<T> {
  const decoder = new TextDecoder();
  let buffer = '';
  const parse = (line: string): T | undefined => {
    if (!line.startsWith('data:')) return undefined;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return undefined;
    try {
      return JSON.parse(data) as T;
    } catch {
      throw new LlmError(`${who} sent an unreadable stream line`);
    }
  };
  for await (const bytes of body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(bytes, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const event = parse(buffer.slice(0, nl).trim());
      buffer = buffer.slice(nl + 1);
      if (event !== undefined) yield event;
    }
  }
  const event = parse((buffer + decoder.decode()).trim());
  if (event !== undefined) yield event;
}

/** A listener that never breaks the call. */
const emit = (opts: GenerateOptions, text: string) => {
  if (!text) return;
  try {
    opts.onText?.(text);
  } catch {
    // Ignored.
  }
};

/** POST JSON; network errors and non-2xx answers become LlmErrors that never contain the key. */
async function post(who: string, url: string, headers: Record<string, string>, body: unknown, signal?: AbortSignal): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', signal, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  } catch (err) {
    signal?.throwIfAborted();
    throw new LlmError(`${who} is not reachable at ${new URL(url).origin} (${err instanceof Error ? err.message : String(err)})`);
  }
  if (!res.ok) throw new LlmError(`${who} ${res.status}: ${(await res.text()).slice(0, 500)}`);
  return res;
}

const parseJson = (who: string, text: string): unknown => {
  try {
    // Some models wrap the JSON in a code fence even when asked for JSON only.
    return JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    throw new LlmError(`${who} returned invalid JSON`);
  }
};

/** Runs `fn`; an abort during a body read is reported as the cancellation, not a read error. */
async function guarded<T>(signal: AbortSignal | undefined, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    signal?.throwIfAborted();
    throw err;
  }
}

export interface OpenAiCompatibleOptions {
  model: string;
  /** Up to /v1 (https://api.openai.com/v1, http://localhost:8000/v1 for vLLM, http://localhost:1234/v1 for LM Studio). */
  baseUrl?: string;
  apiKey?: string;
  /** Azure OpenAI: endpoint https://<resource>.openai.azure.com, `model` is the deployment name. */
  azure?: { endpoint: string; apiVersion?: string };
}

interface ChatChunk {
  choices?: { delta?: { content?: string }; message?: { content?: string }; logprobs?: { content?: TokenLogprob[] | null } | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
}

/**
 * Any server speaking the OpenAI chat completions API: OpenAI, Azure OpenAI, Groq, OpenRouter,
 * Together, Mistral, and self-hosted vLLM, LM Studio or llama.cpp. The answer is constrained with
 * response_format json_schema; a server that does not support it gets json_object and the schema
 * in the prompt instead.
 */
export class OpenAiCompatibleProvider implements LlmProvider {
  readonly id: string;
  private readonly who: string;
  private jsonObjectOnly = false;
  private noTemperature = false;

  constructor(private readonly o: OpenAiCompatibleOptions) {
    this.id = `${o.azure ? 'azure-openai' : 'openai'}:${o.model}`;
    this.who = o.azure ? 'Azure OpenAI' : 'OpenAI-compatible API';
  }

  get url(): string {
    if (this.o.azure) {
      const endpoint = this.o.azure.endpoint.replace(/\/$/, '');
      return `${endpoint}/openai/deployments/${encodeURIComponent(this.o.model)}/chat/completions?api-version=${encodeURIComponent(this.o.azure.apiVersion || '2024-10-21')}`;
    }
    return `${(this.o.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '')}/chat/completions`;
  }

  private headers(): Record<string, string> {
    if (!this.o.apiKey) return {};
    return this.o.azure ? { 'api-key': this.o.apiKey } : { authorization: `Bearer ${this.o.apiKey}` };
  }

  async generate(req: StructuredRequest<z.ZodType>, opts: GenerateOptions = {}): Promise<Answer> {
    try {
      return await this.attempt(req, opts);
    } catch (err) {
      // Learn once what the server refuses, then ask again without it.
      const msg = err instanceof LlmError ? err.message : '';
      if (/ 400: /.test(msg) && /temperature/i.test(msg) && !this.noTemperature) {
        this.noTemperature = true;
        return this.generate(req, opts);
      }
      if (/ 4\d\d: /.test(msg) && /response_format|json_schema/i.test(msg) && !this.jsonObjectOnly) {
        this.jsonObjectOnly = true;
        return this.generate(req, opts);
      }
      throw err;
    }
  }

  private async attempt(req: StructuredRequest<z.ZodType>, opts: GenerateOptions): Promise<Answer> {
    const stream = !!opts.onText;
    const schema = jsonSchema(req.schema);
    const system = this.jsonObjectOnly ? `${req.system}\n\nAnswer with one JSON object matching this JSON Schema:\n${JSON.stringify(schema)}` : req.system;
    const res = await post(
      this.who,
      this.url,
      this.headers(),
      {
        ...(this.o.azure ? {} : { model: this.o.model }),
        stream,
        ...(stream ? { stream_options: { include_usage: true } } : {}),
        ...(this.noTemperature ? {} : { temperature: req.temperature ?? 0 }),
        ...(req.logprobs ? { logprobs: true } : {}),
        response_format: this.jsonObjectOnly ? { type: 'json_object' } : { type: 'json_schema', json_schema: { name: 'answer', schema } },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: req.user },
        ],
      },
      req.signal,
    );
    return guarded(req.signal, async () => {
      let content = '';
      let usage: Usage | undefined;
      const logprobs: TokenLogprob[] = [];
      const take = (chunk: ChatChunk, piece: string | undefined) => {
        if (piece) content += piece;
        for (const t of chunk.choices?.[0]?.logprobs?.content ?? []) logprobs.push({ token: t.token, logprob: t.logprob });
        if (chunk.usage) usage = { inputTokens: chunk.usage.prompt_tokens ?? 0, outputTokens: chunk.usage.completion_tokens ?? 0 };
      };
      if (stream && res.body) {
        for await (const chunk of readSse<ChatChunk>(res.body, this.who)) {
          req.signal?.throwIfAborted();
          const piece = chunk.choices?.[0]?.delta?.content ?? '';
          take(chunk, piece);
          emit(opts, piece);
        }
        req.signal?.throwIfAborted();
      } else {
        const body = (await res.json()) as ChatChunk;
        take(body, body.choices?.[0]?.message?.content ?? '');
      }
      return { output: parseJson(this.who, content), content, ...(logprobs.length ? { logprobs } : {}), ...(usage ? { usage } : {}) };
    });
  }
}

export interface AnthropicOptions {
  model: string;
  apiKey: string;
  baseUrl?: string;
  maxTokens?: number;
}

interface AnthropicEvent {
  type: string;
  message?: { usage?: { input_tokens?: number; output_tokens?: number } };
  delta?: { type?: string; partial_json?: string; text?: string };
  usage?: { output_tokens?: number };
  error?: { message?: string };
  content?: { type: string; input?: unknown; text?: string }[];
}

/**
 * Claude through the Anthropic Messages API. The answer comes as the input of a forced tool call
 * whose input schema is the request schema; streaming sends the tool input as it is written.
 */
export class AnthropicProvider implements LlmProvider {
  readonly id: string;

  constructor(private readonly o: AnthropicOptions) {
    this.id = `anthropic:${o.model}`;
  }

  async generate(req: StructuredRequest<z.ZodType>, opts: GenerateOptions = {}): Promise<Answer> {
    const stream = !!opts.onText;
    const res = await post(
      'Anthropic',
      `${(this.o.baseUrl || 'https://api.anthropic.com').replace(/\/$/, '')}/v1/messages`,
      { 'x-api-key': this.o.apiKey, 'anthropic-version': '2023-06-01' },
      {
        model: this.o.model,
        max_tokens: this.o.maxTokens ?? 8192,
        stream,
        temperature: req.temperature ?? 0,
        system: req.system,
        messages: [{ role: 'user', content: req.user }],
        tools: [{ name: 'answer', description: 'Record the answer.', input_schema: jsonSchema(req.schema) }],
        tool_choice: { type: 'tool', name: 'answer' },
      },
      req.signal,
    );
    return guarded(req.signal, async () => {
      if (stream && res.body) {
        let content = '';
        let usage: Usage = { inputTokens: 0, outputTokens: 0 };
        for await (const ev of readSse<AnthropicEvent>(res.body, 'Anthropic')) {
          req.signal?.throwIfAborted();
          if (ev.type === 'error') throw new LlmError(`Anthropic: ${ev.error?.message ?? 'stream error'}`);
          if (ev.type === 'message_start') usage = { inputTokens: ev.message?.usage?.input_tokens ?? 0, outputTokens: ev.message?.usage?.output_tokens ?? 0 };
          if (ev.type === 'message_delta' && ev.usage?.output_tokens !== undefined) usage = { ...usage, outputTokens: ev.usage.output_tokens };
          if (ev.type === 'content_block_delta' && ev.delta?.type === 'input_json_delta' && ev.delta.partial_json) {
            content += ev.delta.partial_json;
            emit(opts, ev.delta.partial_json);
          }
        }
        req.signal?.throwIfAborted();
        return { output: parseJson('Anthropic', content || '{}'), content, usage };
      }
      const body = (await res.json()) as AnthropicEvent & { usage?: { input_tokens?: number; output_tokens?: number } };
      const tool = body.content?.find((c) => c.type === 'tool_use');
      if (!tool) throw new LlmError('Anthropic returned no answer');
      return {
        output: tool.input,
        content: JSON.stringify(tool.input),
        usage: { inputTokens: body.usage?.input_tokens ?? 0, outputTokens: body.usage?.output_tokens ?? 0 },
      };
    });
  }
}

export interface GeminiOptions {
  model: string;
  apiKey: string;
  baseUrl?: string;
}

interface GeminiChunk {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

/** Google Gemini through the Generative Language API, with the schema in responseJsonSchema. */
export class GeminiProvider implements LlmProvider {
  readonly id: string;

  constructor(private readonly o: GeminiOptions) {
    this.id = `gemini:${o.model}`;
  }

  async generate(req: StructuredRequest<z.ZodType>, opts: GenerateOptions = {}): Promise<Answer> {
    const stream = !!opts.onText;
    const base = (this.o.baseUrl || 'https://generativelanguage.googleapis.com').replace(/\/$/, '');
    const res = await post(
      'Gemini',
      `${base}/v1beta/models/${encodeURIComponent(this.o.model)}:${stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`,
      { 'x-goog-api-key': this.o.apiKey },
      {
        systemInstruction: { parts: [{ text: req.system }] },
        contents: [{ role: 'user', parts: [{ text: req.user }] }],
        generationConfig: { temperature: req.temperature ?? 0, responseMimeType: 'application/json', responseJsonSchema: jsonSchema(req.schema) },
      },
      req.signal,
    );
    return guarded(req.signal, async () => {
      let content = '';
      let usage: Usage | undefined;
      const take = (chunk: GeminiChunk) => {
        const piece = (chunk.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
        content += piece;
        if (chunk.usageMetadata) usage = { inputTokens: chunk.usageMetadata.promptTokenCount ?? 0, outputTokens: chunk.usageMetadata.candidatesTokenCount ?? 0 };
        return piece;
      };
      if (stream && res.body) {
        for await (const chunk of readSse<GeminiChunk>(res.body, 'Gemini')) {
          req.signal?.throwIfAborted();
          emit(opts, take(chunk));
        }
        req.signal?.throwIfAborted();
      } else {
        take((await res.json()) as GeminiChunk);
      }
      return { output: parseJson('Gemini', content), content, ...(usage ? { usage } : {}) };
    });
  }
}

export const LLM_PROVIDERS = ['ollama', 'openai', 'azure-openai', 'anthropic', 'gemini'] as const;
export type LlmProviderKind = (typeof LLM_PROVIDERS)[number];

/**
 * The model from the environment. LLM_PROVIDER picks the service (default ollama):
 *   ollama        LLM_MODEL (default qwen3.8), OLLAMA_BASE_URL
 *   openai        LLM_REMOTE_MODEL or LLM_MODEL, OPENAI_BASE_URL (default api.openai.com/v1), OPENAI_API_KEY
 *   azure-openai  deployment in LLM_REMOTE_MODEL or LLM_MODEL, AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, AZURE_OPENAI_API_VERSION
 *   anthropic     LLM_REMOTE_MODEL or LLM_MODEL, ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL
 *   gemini        LLM_REMOTE_MODEL or LLM_MODEL, GEMINI_API_KEY, GEMINI_BASE_URL
 * With AI_LOCAL_ONLY on (the default) anything but a local server is refused.
 */
export function llmProviderFromEnv(env: NodeJS.ProcessEnv = process.env): LlmProvider {
  const kind = (env.LLM_PROVIDER || 'ollama') as LlmProviderKind;
  if (kind === 'ollama') return new OllamaProvider(env.LLM_MODEL || undefined, env.OLLAMA_BASE_URL || undefined);
  const model = env.LLM_REMOTE_MODEL || env.LLM_MODEL;
  if (!model) throw new LlmError(`LLM_PROVIDER=${kind} needs a model (LLM_REMOTE_MODEL)`);
  const need = (name: string) => {
    const v = env[name];
    if (!v) throw new LlmError(`LLM_PROVIDER=${kind} needs ${name}`);
    return v;
  };
  switch (kind) {
    case 'openai': {
      const baseUrl = env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
      assertAiAllowed('The OpenAI-compatible API', baseUrl, env);
      return new OpenAiCompatibleProvider({ model, baseUrl, apiKey: env.OPENAI_API_KEY || undefined });
    }
    case 'azure-openai': {
      const endpoint = need('AZURE_OPENAI_ENDPOINT');
      assertAiAllowed('Azure OpenAI', endpoint, env);
      return new OpenAiCompatibleProvider({ model, apiKey: need('AZURE_OPENAI_API_KEY'), azure: { endpoint, apiVersion: env.AZURE_OPENAI_API_VERSION || undefined } });
    }
    case 'anthropic': {
      const baseUrl = env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
      assertAiAllowed('Anthropic', baseUrl, env);
      return new AnthropicProvider({ model, apiKey: need('ANTHROPIC_API_KEY'), baseUrl });
    }
    case 'gemini': {
      const baseUrl = env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com';
      assertAiAllowed('Gemini', baseUrl, env);
      return new GeminiProvider({ model, apiKey: need('GEMINI_API_KEY'), baseUrl });
    }
    default:
      throw new LlmError(`Unknown LLM_PROVIDER ${String(kind)} (expected ${LLM_PROVIDERS.join(', ')})`);
  }
}

/** The client from the environment: llmProviderFromEnv, LLM_CACHE_DIR, LLM_CACHE_MODE=off|readwrite|replay. */
export function llmFromEnv(env: NodeJS.ProcessEnv = process.env): LlmClient {
  return new LlmClient(llmProviderFromEnv(env), env.LLM_CACHE_DIR || undefined, (env.LLM_CACHE_MODE as CacheMode) || undefined);
}
