import { assertAiAllowed } from '@doccheck/schemas';
import { OllamaEmbedder, type Embedder } from './search';

async function post(who: string, url: string, headers: Record<string, string>, body: unknown): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  } catch (err) {
    throw new Error(`${who} is not reachable at ${new URL(url).origin} (${err instanceof Error ? err.message : String(err)})`);
  }
  if (!res.ok) throw new Error(`${who} embed ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res;
}

/** Texts per request: the APIs cap the batch size (OpenAI 2048 inputs, Gemini 100). */
const BATCH = 96;

async function inBatches(texts: string[], fn: (batch: string[]) => Promise<number[][]>): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) out.push(...(await fn(texts.slice(i, i + BATCH))));
  return out;
}

export interface OpenAiEmbedderOptions {
  model: string;
  baseUrl?: string;
  apiKey?: string;
  /** Shorter vectors (text-embedding-3 models accept it). */
  dimensions?: number;
  azure?: { endpoint: string; apiVersion?: string };
}

/** /v1/embeddings of OpenAI, Azure OpenAI, or a self-hosted server speaking the same API (vLLM, LM Studio, TEI). */
export class OpenAiCompatibleEmbedder implements Embedder {
  readonly id: string;

  constructor(private readonly o: OpenAiEmbedderOptions) {
    this.id = `${o.azure ? 'azure-openai' : 'openai'}:${o.model}${o.dimensions ? `@${o.dimensions}` : ''}`;
  }

  embed(texts: string[]): Promise<number[][]> {
    const url = this.o.azure
      ? `${this.o.azure.endpoint.replace(/\/$/, '')}/openai/deployments/${encodeURIComponent(this.o.model)}/embeddings?api-version=${encodeURIComponent(this.o.azure.apiVersion || '2024-10-21')}`
      : `${(this.o.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '')}/embeddings`;
    const headers: Record<string, string> = !this.o.apiKey ? {} : this.o.azure ? { 'api-key': this.o.apiKey } : { authorization: `Bearer ${this.o.apiKey}` };
    return inBatches(texts, async (input) => {
      const res = await post(this.o.azure ? 'Azure OpenAI' : 'OpenAI-compatible API', url, headers, {
        ...(this.o.azure ? {} : { model: this.o.model }),
        input,
        ...(this.o.dimensions ? { dimensions: this.o.dimensions } : {}),
      });
      const body = (await res.json()) as { data: { index: number; embedding: number[] }[] };
      return [...body.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
    });
  }
}

export interface GeminiEmbedderOptions {
  model: string;
  apiKey: string;
  baseUrl?: string;
  dimensions?: number;
}

/** Gemini embeddings (batchEmbedContents). */
export class GeminiEmbedder implements Embedder {
  readonly id: string;

  constructor(private readonly o: GeminiEmbedderOptions) {
    this.id = `gemini:${o.model}${o.dimensions ? `@${o.dimensions}` : ''}`;
  }

  embed(texts: string[]): Promise<number[][]> {
    const base = (this.o.baseUrl || 'https://generativelanguage.googleapis.com').replace(/\/$/, '');
    const model = `models/${this.o.model.replace(/^models\//, '')}`;
    return inBatches(texts, async (batch) => {
      const res = await post('Gemini', `${base}/v1beta/${model}:batchEmbedContents`, { 'x-goog-api-key': this.o.apiKey }, {
        requests: batch.map((text) => ({ model, content: { parts: [{ text }] }, ...(this.o.dimensions ? { outputDimensionality: this.o.dimensions } : {}) })),
      });
      const body = (await res.json()) as { embeddings: { values: number[] }[] };
      return body.embeddings.map((e) => e.values);
    });
  }
}

export const EMBED_PROVIDERS = ['ollama', 'openai', 'azure-openai', 'gemini'] as const;
export type EmbedProviderKind = (typeof EMBED_PROVIDERS)[number];

/**
 * The embedding model from the environment. EMBED_PROVIDER picks the service (default ollama),
 * EMBED_MODEL the model (default bge-m3 on Ollama), EMBED_DIMENSIONS shorter vectors where the API
 * allows it. Credentials as for the LLM (OPENAI_*, AZURE_OPENAI_*, GEMINI_*); AI_LOCAL_ONLY applies.
 */
export function embedderFromEnv(env: NodeJS.ProcessEnv = process.env): Embedder {
  const kind = (env.EMBED_PROVIDER || 'ollama') as EmbedProviderKind;
  const model = env.EMBED_MODEL || (kind === 'ollama' ? 'bge-m3' : undefined);
  if (!model) throw new Error(`EMBED_PROVIDER=${kind} needs EMBED_MODEL`);
  const dimensions = Number(env.EMBED_DIMENSIONS) || undefined;
  const need = (name: string) => {
    if (!env[name]) throw new Error(`EMBED_PROVIDER=${kind} needs ${name}`);
    return env[name]!;
  };
  switch (kind) {
    case 'ollama':
      return new OllamaEmbedder(model, env.OLLAMA_BASE_URL || undefined);
    case 'openai': {
      const baseUrl = env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
      assertAiAllowed('The OpenAI-compatible embedding API', baseUrl, env);
      return new OpenAiCompatibleEmbedder({ model, baseUrl, apiKey: env.OPENAI_API_KEY || undefined, dimensions });
    }
    case 'azure-openai': {
      const endpoint = need('AZURE_OPENAI_ENDPOINT');
      assertAiAllowed('Azure OpenAI', endpoint, env);
      return new OpenAiCompatibleEmbedder({ model, apiKey: need('AZURE_OPENAI_API_KEY'), dimensions, azure: { endpoint, apiVersion: env.AZURE_OPENAI_API_VERSION || undefined } });
    }
    case 'gemini': {
      const baseUrl = env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com';
      assertAiAllowed('Gemini', baseUrl, env);
      return new GeminiEmbedder({ model, apiKey: need('GEMINI_API_KEY'), baseUrl, dimensions });
    }
    default:
      throw new Error(`Unknown EMBED_PROVIDER ${String(kind)} (expected ${EMBED_PROVIDERS.join(', ')})`);
  }
}

/**
 * The file name an index built with this embedder gets: the bare model for Ollama (bge-m3.json, as
 * before), the provider and model otherwise ("openai-text-embedding-3-small"). Vectors of two
 * embedders are never compared, so each has its own index.
 */
export function indexName(embedderId: string): string {
  const [provider, ...rest] = embedderId.split(':');
  const model = rest.join(':');
  const name = provider === 'ollama' ? model : `${provider}-${model}`;
  return name.replace(/[^\w.@-]+/g, '-');
}
