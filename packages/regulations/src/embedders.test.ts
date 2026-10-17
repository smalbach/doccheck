import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { embedderFromEnv, GeminiEmbedder, indexName, OpenAiCompatibleEmbedder } from './embedders';
import { OllamaEmbedder } from './search';

const servers: Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

async function fake(answer: (body: any, url: string) => unknown) {
  const seen: { url: string; headers: Record<string, unknown>; body: any }[] = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw);
      seen.push({ url: req.url ?? '', headers: req.headers, body });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(answer(body, req.url ?? '')));
    });
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen };
}

describe('embedding providers', () => {
  it('OpenAI-compatible: vectors in input order, in batches', async () => {
    const api = await fake((body) => ({ data: (body.input as string[]).map((t, index) => ({ index, embedding: [t.length, index] })).reverse() }));
    const e = new OpenAiCompatibleEmbedder({ model: 'text-embedding-3-small', baseUrl: `${api.url}/v1`, apiKey: 'k', dimensions: 256 });
    const texts = Array.from({ length: 100 }, (_, i) => 'x'.repeat(i + 1));
    const vectors = await e.embed(texts);
    expect(vectors[0]).toEqual([1, 0]);
    expect(vectors[99]).toEqual([100, 3]);
    expect(api.seen).toHaveLength(2);
    expect(api.seen[0].url).toBe('/v1/embeddings');
    expect(api.seen[0].body.dimensions).toBe(256);
    expect(api.seen[0].headers.authorization).toBe('Bearer k');
    expect(e.id).toBe('openai:text-embedding-3-small@256');
  });

  it('Gemini: batchEmbedContents with outputDimensionality', async () => {
    const api = await fake((body) => ({ embeddings: body.requests.map((_: unknown, i: number) => ({ values: [i] })) }));
    const vectors = await new GeminiEmbedder({ model: 'gemini-embedding-001', apiKey: 'g', baseUrl: api.url, dimensions: 768 }).embed(['a', 'b']);
    expect(vectors).toEqual([[0], [1]]);
    expect(api.seen[0].url).toBe('/v1beta/models/gemini-embedding-001:batchEmbedContents');
    expect(api.seen[0].body.requests[0]).toEqual({ model: 'models/gemini-embedding-001', content: { parts: [{ text: 'a' }] }, outputDimensionality: 768 });
  });

  it('from the environment: Ollama bge-m3 by default, outside services only when allowed', () => {
    expect(embedderFromEnv({})).toBeInstanceOf(OllamaEmbedder);
    expect(embedderFromEnv({}).id).toBe('ollama:bge-m3');
    expect(() => embedderFromEnv({ EMBED_PROVIDER: 'openai', EMBED_MODEL: 'text-embedding-3-small' })).toThrow(/local only/);
    expect(embedderFromEnv({ EMBED_PROVIDER: 'openai', EMBED_MODEL: 'nomic', OPENAI_BASE_URL: 'http://localhost:1234/v1' }).id).toBe('openai:nomic');
    expect(embedderFromEnv({ AI_LOCAL_ONLY: 'false', EMBED_PROVIDER: 'gemini', EMBED_MODEL: 'gemini-embedding-001', GEMINI_API_KEY: 'k' }).id).toBe('gemini:gemini-embedding-001');
    expect(() => embedderFromEnv({ AI_LOCAL_ONLY: 'false', EMBED_PROVIDER: 'openai' })).toThrow('EMBED_MODEL');
  });

  it('names index files so Ollama keeps its old ones', () => {
    expect(indexName('ollama:bge-m3')).toBe('bge-m3');
    expect(indexName('openai:text-embedding-3-small@256')).toBe('openai-text-embedding-3-small@256');
    expect(indexName('ollama:org/model:q4')).toBe('org-model-q4');
  });
});
