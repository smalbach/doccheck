import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { ExtractionUpdate, OutputDelta } from '@doccheck/schemas';
import { extractFromText } from './extract';
import { LlmClient, OllamaProvider, readNdjson, replayAsStream, type LlmProvider, type StreamChunk } from './llm';
import { throttleOutput } from './stream';

/** A body that arrives in the given pieces (split anywhere, even inside a line or a character). */
const bodyOf = (...pieces: (string | Uint8Array)[]) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      for (const p of pieces) c.enqueue(typeof p === 'string' ? new TextEncoder().encode(p) : p);
      c.close();
    },
  });

const collect = async <T>(gen: AsyncGenerator<T>) => {
  const out: T[] = [];
  for await (const x of gen) out.push(x);
  return out;
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('streaming parser', () => {
  it('reads newline-delimited JSON whatever the chunk boundaries', async () => {
    const e = new TextEncoder().encode('{"c":"é"}\n');
    const lines = await collect(readNdjson(bodyOf('{"a":1}\n{"b"', ':2}\n\n', e.slice(0, 7), e.slice(7), '{"d":4}')));
    expect(lines).toEqual([{ a: 1 }, { b: 2 }, { c: 'é' }, { d: 4 }]);
  });

  it('rejects a line that is not JSON', async () => {
    await expect(collect(readNdjson(bodyOf('{"a":1}\nnot json\n')))).rejects.toThrow('unreadable stream line');
  });

  it('streams an Ollama answer and returns the same result as without streaming', async () => {
    const answer = '{"total": "12.50"}';
    const lines = [...answer].map((ch) => JSON.stringify({ message: { content: ch }, done: false }) + '\n');
    lines.push(JSON.stringify({ message: { content: '' }, done: true, prompt_eval_count: 40, eval_count: 18 }) + '\n');
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      const stream = JSON.parse(init.body as string).stream as boolean;
      return stream
        ? new Response(bodyOf(lines.join('').slice(0, 30), lines.join('').slice(30)))
        : Response.json({ message: { content: answer }, prompt_eval_count: 40, eval_count: 18 });
    });
    vi.stubGlobal('fetch', fetch);
    const provider = new OllamaProvider('test');
    const req = { system: 's', user: 'u', schema: z.object({ total: z.string() }) };
    const pieces: string[] = [];
    const streamed = await provider.generate(req, { onText: (t) => pieces.push(t) });
    const plain = await provider.generate(req);
    expect(pieces.join('')).toBe(answer);
    expect(streamed).toEqual(plain);
    expect(streamed).toEqual({ output: { total: '12.50' }, usage: { inputTokens: 40, outputTokens: 18 } });
    expect(fetch.mock.calls.map(([, init]) => JSON.parse(init.body as string).stream)).toEqual([true, false]);
  });

  it('turns an error line of the stream into an error', async () => {
    vi.stubGlobal('fetch', async () => new Response(bodyOf('{"message":{"content":"{"}}\n{"error":"model unloaded"}\n')));
    await expect(new OllamaProvider('test').generate({ system: 's', user: 'u', schema: z.object({}) }, { onText: () => undefined })).rejects.toThrow('model unloaded');
  });
});

describe('output throttle', () => {
  const setup = (opts: { intervalMs?: number; maxChars?: number } = {}) => {
    vi.useFakeTimers({ now: 0 });
    const sent: OutputDelta[] = [];
    const t = throttleOutput((d) => void sent.push(d), { intervalMs: 300, ...opts });
    return { sent, t };
  };
  const tok = (text: string): StreamChunk => ({ text, tokens: 1 });

  it('sends the first chunk at once, then at most one delta per interval', async () => {
    const { sent, t } = setup();
    t.push(tok('{"a'));
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(50);
      t.push(tok('b'));
    }
    await vi.advanceTimersByTimeAsync(0);
    // 0 ms: first chunk; 300 ms (timer, before the chunk of 300 ms): the five since; the rest on flush.
    expect(sent.map((d) => d.delta)).toEqual(['{"a', 'bbbbb']);
    await t.flush();
    expect(sent.map((d) => [d.delta, d.offset, d.tokens])).toEqual([
      ['{"a', 0, 1],
      ['bbbbb', 3, 6],
      ['bbbbb', 8, 11],
    ]);
    expect(sent.map((d) => d.delta).join('')).toBe('{"a' + 'b'.repeat(10));
  });

  it('sends what is pending when the interval ends, without another chunk', async () => {
    const { sent, t } = setup();
    t.push(tok('x'));
    t.push(tok('y'));
    await vi.advanceTimersByTimeAsync(299);
    expect(sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sent.map((d) => d.delta)).toEqual(['x', 'y']);
  });

  it('reports the speed once half a second has passed', async () => {
    const { sent, t } = setup();
    t.push(tok('a'));
    for (let i = 0; i < 19; i++) {
      vi.advanceTimersByTime(50);
      t.push(tok('a'));
    }
    await t.flush();
    expect(sent[0].tokensPerSecond).toBeUndefined();
    // 20 tokens in 950 ms.
    expect(sent.at(-1)).toMatchObject({ tokens: 20, tokensPerSecond: 21.1 });
  });

  it('splits a long delta so every event stays small, and keeps characters whole', async () => {
    const { sent, t } = setup({ maxChars: 4 });
    t.push(tok('ab'));
    t.push(tok('cde😀fghij'));
    await t.flush();
    expect(sent.map((d) => [d.delta, d.offset])).toEqual([
      ['ab', 0],
      ['cde', 2],
      ['😀fg', 5],
      ['hij', 9],
    ]);
  });

  it('starts over on a retry, and tells the client', async () => {
    const { sent, t } = setup();
    t.push(tok('{"bad"'));
    vi.advanceTimersByTime(400);
    t.push({ text: '', tokens: 0, restart: true });
    t.push(tok('{"good"'));
    await t.flush();
    expect(sent.slice(1)).toEqual([
      { delta: '', offset: 0, tokens: 0, restart: true },
      { delta: '{"good"', offset: 0, tokens: 1 },
    ]);
  });

  it('ignores chunks after the flush and survives a failing send', async () => {
    vi.useFakeTimers({ now: 0 });
    const sent: string[] = [];
    const t = throttleOutput((d) => {
      sent.push(d.delta ?? '');
      if (sent.length === 1) throw new Error('db down');
    });
    t.push(tok('a'));
    vi.advanceTimersByTime(1000);
    t.push(tok('b'));
    await t.flush();
    t.push(tok('c'));
    await t.flush();
    expect(sent).toEqual(['a', 'b']);
  });
});

describe('cache replay as a stream', () => {
  const schema = z.object({ invoiceNumber: z.string(), total: z.string() });
  const output = { invoiceNumber: 'INV-7', total: '1,200.00' };
  const req = { system: 'sys', user: 'doc', schema };
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('replays the cached answer in chunks that add up to it and to its token count', async () => {
    const chunks: StreamChunk[] = [];
    await replayAsStream(output, { inputTokens: 100, outputTokens: 17 }, (c) => chunks.push(c));
    expect(chunks.map((c) => c.text).join('')).toBe(JSON.stringify(output, null, 2));
    expect(chunks.reduce((n, c) => n + c.tokens, 0)).toBe(17);
    expect(chunks.every((c) => c.replay)).toBe(true);
  });

  it('spreads a paced replay over the time asked', async () => {
    vi.useFakeTimers({ now: 0 });
    const times: number[] = [];
    const done = replayAsStream(output, undefined, () => times.push(Date.now()), 400);
    await vi.runAllTimersAsync();
    await done;
    expect(times).toHaveLength(10);
    expect(times[0]).toBe(0);
    expect(times.at(-1)).toBe(360);
  });

  it('streams a cache hit like a model call, and stores the same answer', async () => {
    dir = await mkdtemp(join(tmpdir(), 'doccheck-stream-'));
    const provider: LlmProvider = {
      id: 'fake:stream',
      generate: async (_req, opts) => {
        for (const piece of ['{"invoiceNumber": ', '"INV-7", ', '"total": "1,200.00"}']) opts?.onText?.(piece);
        return { output, usage: { inputTokens: 50, outputTokens: 3 } };
      },
    };
    const llm = new LlmClient(provider, dir, 'readwrite');
    const live: StreamChunk[] = [];
    const first = await llm.call('v1', req, { onChunk: (c) => live.push(c) });
    expect(first.cached).toBe(false);
    expect(live.map((c) => c.text).join('')).toBe('{"invoiceNumber": "INV-7", "total": "1,200.00"}');
    expect(live.every((c) => c.tokens === 1 && !c.replay)).toBe(true);

    const replayed: StreamChunk[] = [];
    const second = await llm.call('v1', req, { onChunk: (c) => replayed.push(c) });
    expect(second).toEqual({ output, usage: { inputTokens: 50, outputTokens: 3 }, cached: true });
    expect(JSON.parse(replayed.map((c) => c.text).join(''))).toEqual(output);
    expect(replayed.reduce((n, c) => n + c.tokens, 0)).toBe(3);

    // Without onChunk nothing streams, and the answer is the same.
    expect(await llm.call('v1', req)).toEqual(second);
  });

  it('restarts the stream when the answer is retried, and never lets a listener break the call', async () => {
    const outputs = [{ invoiceNumber: 'INV-7' }, output];
    const provider: LlmProvider = {
      id: 'fake:retry',
      generate: async (_req, opts) => {
        const out = outputs.shift();
        opts?.onText?.(JSON.stringify(out));
        return { output: out };
      },
    };
    const chunks: StreamChunk[] = [];
    const result = await new LlmClient(provider).call('v1', req, {
      onChunk: (c) => {
        chunks.push(c);
        throw new Error('listener bug');
      },
    });
    expect(result.output).toEqual(output);
    expect(chunks.map((c) => [c.text.slice(0, 5), !!c.restart])).toEqual([
      ['{"inv', false],
      ['', true],
      ['{"inv', false],
    ]);
  });

  it('reports the answer as ephemeral extracting deltas, ending before the stage does', async () => {
    dir = await mkdtemp(join(tmpdir(), 'doccheck-stream-'));
    const pkg = { range: '1-10', count: '10', packageType: 'CTN', sku: null, description: 'Toys', quantity: '100', unit: 'PCS', netWeight: null, grossWeight: null, dimensionsCm: null };
    const raw = { packingListNumber: 'PL-1', invoiceRef: 'INV-1', seller: null, consignee: null, marks: null, packages: [pkg], totalPackages: '10', totalNetWeight: null, totalGrossWeight: null, totalVolumeM3: null };
    const llm = new LlmClient({ id: 'fake:pl', generate: async () => ({ output: raw, usage: { inputTokens: 9, outputTokens: 120 } }) }, dir, 'readwrite');
    const pdf = { pageCount: 1, lines: [], text: 'PACKING LIST' };
    await extractFromText(pdf, 'PACKING_LIST', llm);
    const seen: ExtractionUpdate[] = [];
    const out = await extractFromText(pdf, 'PACKING_LIST', llm, (u) => void seen.push(u));
    expect(out.cached).toBe(true);
    const deltas = seen.filter((u) => u.ephemeral);
    expect(deltas.length).toBeGreaterThan(0);
    expect(deltas.every((u) => u.stage === 'extracting' && u.status === 'progress')).toBe(true);
    if (deltas[0].stage !== 'extracting') throw new Error('unreachable');
    expect(JSON.parse(deltas.map((u) => (u.stage === 'extracting' ? u.detail?.delta : '')).join(''))).toEqual(raw);
    expect(deltas.at(-1)?.detail).toMatchObject({ tokens: 120, replay: true });
    expect(seen.filter((u) => !u.ephemeral).map((u) => `${u.stage}:${u.status}`)).toEqual(['extracting:started', 'extracting:done', 'normalizing:started', 'normalizing:done']);
    expect(seen.findIndex((u) => u.stage === 'extracting' && u.status === 'done')).toBeGreaterThan(seen.lastIndexOf(deltas.at(-1)!));
  });
});
