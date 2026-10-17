import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { LlmClient, OllamaProvider } from './llm';
import { AnthropicProvider, GeminiProvider, llmProviderFromEnv, OpenAiCompatibleProvider, readSse } from './llm-providers';
import { cloudOcrProblem, ocrAzureDocumentIntelligence, ocrGoogleVision, ocrTextract, signAws, type PageImage } from './ocr-cloud';

interface Seen {
  url: string;
  headers: IncomingMessage['headers'];
  body: Record<string, any>;
}

const servers: Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

/** A fake API: `handle` answers each request; every request is recorded in `seen`. */
async function fake(handle: (req: Seen, res: ServerResponse) => void) {
  const seen: Seen[] = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const s = { url: req.url ?? '', headers: req.headers, body: raw ? JSON.parse(raw) : {} };
      seen.push(s);
      handle(s, res);
    });
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen };
}

const json = (res: ServerResponse, body: unknown, status = 200) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};
const sse = (res: ServerResponse, events: unknown[]) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const e of events) res.write(`data: ${JSON.stringify(e)}\n\n`);
  res.end('data: [DONE]\n\n');
};

const schema = z.object({ invoiceNumber: z.string(), total: z.number() });
const req = { system: 'Read the invoice.', user: 'Invoice INV-7, total 12.5', schema };

describe('readSse', () => {
  it('reads data lines whatever the chunk boundaries and stops at [DONE]', async () => {
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (const p of ['data: {"a":', '1}\n\nevent: x\ndata: {"b":2}\n', '\ndata: [DONE]\n\n']) c.enqueue(enc.encode(p));
        c.close();
      },
    });
    const out = [];
    for await (const e of readSse(body, 'test')) out.push(e);
    expect(out).toEqual([{ a: 1 }, { b: 2 }]);
  });
});

describe('OpenAI-compatible provider', () => {
  it('asks for the schema with response_format and reads answer and usage', async () => {
    const api = await fake((_, res) => json(res, { choices: [{ message: { content: '{"invoiceNumber":"INV-7","total":12.5}' } }], usage: { prompt_tokens: 30, completion_tokens: 9 } }));
    const provider = new OpenAiCompatibleProvider({ model: 'gpt-test', baseUrl: `${api.url}/v1`, apiKey: 'sk-test' });
    const out = await new LlmClient(provider).call('v1', req);
    expect(out.output).toEqual({ invoiceNumber: 'INV-7', total: 12.5 });
    expect(out.usage).toEqual({ inputTokens: 30, outputTokens: 9 });
    expect(provider.id).toBe('openai:gpt-test');
    const [r] = api.seen;
    expect(r.url).toBe('/v1/chat/completions');
    expect(r.headers.authorization).toBe('Bearer sk-test');
    expect(r.body.model).toBe('gpt-test');
    expect(r.body.response_format.type).toBe('json_schema');
    expect(r.body.response_format.json_schema.schema.required).toEqual(['invoiceNumber', 'total']);
    expect(r.body.response_format.json_schema.schema.$schema).toBeUndefined();
  });

  it('streams the answer as it is written, with usage from the last chunk', async () => {
    const api = await fake((_, res) =>
      sse(res, [{ choices: [{ delta: { content: '{"invoiceNumber":' } }] }, { choices: [{ delta: { content: '"INV-7","total":12.5}' } }] }, { choices: [], usage: { prompt_tokens: 5, completion_tokens: 4 } }]),
    );
    const pieces: string[] = [];
    const out = await new LlmClient(new OpenAiCompatibleProvider({ model: 'm', baseUrl: api.url })).call('v1', req, { onChunk: (c) => pieces.push(c.text) });
    expect(pieces.join('')).toBe('{"invoiceNumber":"INV-7","total":12.5}');
    expect(out.usage).toEqual({ inputTokens: 5, outputTokens: 4 });
    expect(api.seen[0].body.stream_options).toEqual({ include_usage: true });
  });

  it('falls back to json_object, and drops the temperature, when the server refuses them', async () => {
    const api = await fake((r, res) => {
      if (r.body.temperature !== undefined) return json(res, { error: { message: 'Unsupported value: temperature' } }, 400);
      if (r.body.response_format.type === 'json_schema') return json(res, { error: { message: 'response_format json_schema is not supported' } }, 400);
      json(res, { choices: [{ message: { content: '```json\n{"invoiceNumber":"A","total":1}\n```' } }] });
    });
    const out = await new LlmClient(new OpenAiCompatibleProvider({ model: 'm', baseUrl: api.url })).call('v1', req);
    expect(out.output).toEqual({ invoiceNumber: 'A', total: 1 });
    const last = api.seen.at(-1)!;
    expect(last.body.response_format).toEqual({ type: 'json_object' });
    expect(last.body.messages[0].content).toContain('JSON Schema');
  });

  it('calls an Azure deployment with an api-key header', async () => {
    const api = await fake((_, res) => json(res, { choices: [{ message: { content: '{"invoiceNumber":"A","total":1}' } }] }));
    await new OpenAiCompatibleProvider({ model: 'my-deploy', apiKey: 'az-key', azure: { endpoint: api.url, apiVersion: '2024-10-21' } }).generate(req);
    const [r] = api.seen;
    expect(r.url).toBe('/openai/deployments/my-deploy/chat/completions?api-version=2024-10-21');
    expect(r.headers['api-key']).toBe('az-key');
    expect(r.headers.authorization).toBeUndefined();
    expect(r.body.model).toBeUndefined();
  });

  it('never puts the key in an error', async () => {
    const api = await fake((_, res) => json(res, { error: 'bad' }, 401));
    await expect(new OpenAiCompatibleProvider({ model: 'm', baseUrl: api.url, apiKey: 'sk-secret' }).generate(req)).rejects.toThrow(/401/);
    await expect(new OpenAiCompatibleProvider({ model: 'm', baseUrl: api.url, apiKey: 'sk-secret' }).generate(req)).rejects.not.toThrow(/sk-secret/);
  });
});

describe('Anthropic provider', () => {
  it('forces a tool whose input schema is the request schema', async () => {
    const api = await fake((_, res) => json(res, { content: [{ type: 'tool_use', name: 'answer', input: { invoiceNumber: 'INV-7', total: 12.5 } }], usage: { input_tokens: 40, output_tokens: 12 } }));
    const out = await new LlmClient(new AnthropicProvider({ model: 'claude-test', apiKey: 'ant-key', baseUrl: api.url })).call('v1', req);
    expect(out.output).toEqual({ invoiceNumber: 'INV-7', total: 12.5 });
    expect(out.usage).toEqual({ inputTokens: 40, outputTokens: 12 });
    const [r] = api.seen;
    expect(r.url).toBe('/v1/messages');
    expect(r.headers['x-api-key']).toBe('ant-key');
    expect(r.headers['anthropic-version']).toBe('2023-06-01');
    expect(r.body.tool_choice).toEqual({ type: 'tool', name: 'answer' });
    expect(r.body.tools[0].input_schema.properties.total.type).toBe('number');
    expect(r.body.system).toBe('Read the invoice.');
  });

  it('streams the tool input', async () => {
    const api = await fake((_, res) =>
      sse(res, [
        { type: 'message_start', message: { usage: { input_tokens: 7, output_tokens: 1 } } },
        { type: 'content_block_start', index: 0 },
        { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"invoiceNumber": "X",' } },
        { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: ' "total": 2}' } },
        { type: 'message_delta', usage: { output_tokens: 11 } },
        { type: 'message_stop' },
      ]),
    );
    const pieces: string[] = [];
    const out = await new LlmClient(new AnthropicProvider({ model: 'c', apiKey: 'k', baseUrl: api.url })).call('v1', req, { onChunk: (c) => pieces.push(c.text) });
    expect(out.output).toEqual({ invoiceNumber: 'X', total: 2 });
    expect(out.usage).toEqual({ inputTokens: 7, outputTokens: 11 });
    expect(pieces.join('')).toBe('{"invoiceNumber": "X", "total": 2}');
  });
});

describe('Gemini provider', () => {
  it('sends the schema as responseJsonSchema', async () => {
    const api = await fake((_, res) => json(res, { candidates: [{ content: { parts: [{ text: '{"invoiceNumber":"G","total":3}' }] } }], usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 6 } }));
    const out = await new LlmClient(new GeminiProvider({ model: 'gemini-test', apiKey: 'g-key', baseUrl: api.url })).call('v1', req);
    expect(out.output).toEqual({ invoiceNumber: 'G', total: 3 });
    expect(out.usage).toEqual({ inputTokens: 8, outputTokens: 6 });
    const [r] = api.seen;
    expect(r.url).toBe('/v1beta/models/gemini-test:generateContent');
    expect(r.headers['x-goog-api-key']).toBe('g-key');
    expect(r.body.generationConfig.responseMimeType).toBe('application/json');
    expect(r.body.generationConfig.responseJsonSchema.required).toEqual(['invoiceNumber', 'total']);
  });

  it('streams over server-sent events', async () => {
    const api = await fake((_, res) => sse(res, [{ candidates: [{ content: { parts: [{ text: '{"invoiceNumber":"G",' }] } }] }, { candidates: [{ content: { parts: [{ text: '"total":3}' }] } }] }]));
    const pieces: string[] = [];
    await new LlmClient(new GeminiProvider({ model: 'g', apiKey: 'k', baseUrl: api.url })).call('v1', req, { onChunk: (c) => pieces.push(c.text) });
    expect(api.seen[0].url).toBe('/v1beta/models/g:streamGenerateContent?alt=sse');
    expect(pieces.join('')).toBe('{"invoiceNumber":"G","total":3}');
  });
});

describe('llmProviderFromEnv', () => {
  it('is Ollama by default', () => {
    expect(llmProviderFromEnv({ LLM_MODEL: 'qwen3.8' })).toBeInstanceOf(OllamaProvider);
  });

  it('refuses outside services while local only is on (the default)', () => {
    expect(() => llmProviderFromEnv({ LLM_PROVIDER: 'anthropic', LLM_REMOTE_MODEL: 'c', ANTHROPIC_API_KEY: 'k' })).toThrow(/local only/);
    expect(() => llmProviderFromEnv({ LLM_PROVIDER: 'openai', LLM_REMOTE_MODEL: 'gpt' })).toThrow(/local only/);
  });

  it('allows a self-hosted OpenAI-compatible server while local only is on', () => {
    expect(llmProviderFromEnv({ LLM_PROVIDER: 'openai', LLM_REMOTE_MODEL: 'llama', OPENAI_BASE_URL: 'http://192.168.1.20:8000/v1' }).id).toBe('openai:llama');
    expect(llmProviderFromEnv({ LLM_PROVIDER: 'openai', LLM_REMOTE_MODEL: 'llama', OPENAI_BASE_URL: 'http://vllm:8000/v1' }).id).toBe('openai:llama');
  });

  it('builds each outside provider once allowed, and says what is missing', () => {
    const env = { AI_LOCAL_ONLY: 'false', LLM_REMOTE_MODEL: 'm' };
    expect(llmProviderFromEnv({ ...env, LLM_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k' })).toBeInstanceOf(AnthropicProvider);
    expect(llmProviderFromEnv({ ...env, LLM_PROVIDER: 'gemini', GEMINI_API_KEY: 'k' })).toBeInstanceOf(GeminiProvider);
    expect(llmProviderFromEnv({ ...env, LLM_PROVIDER: 'azure-openai', AZURE_OPENAI_ENDPOINT: 'https://x.openai.azure.com', AZURE_OPENAI_API_KEY: 'k' }).id).toBe('azure-openai:m');
    expect(() => llmProviderFromEnv({ ...env, LLM_PROVIDER: 'gemini' })).toThrow('GEMINI_API_KEY');
    expect(() => llmProviderFromEnv({ AI_LOCAL_ONLY: 'false', LLM_PROVIDER: 'gemini', GEMINI_API_KEY: 'k' })).toThrow(/needs a model/);
  });
});

const img: PageImage = { png: new Uint8Array([1, 2, 3]), widthPx: 1000, heightPx: 2000, widthPt: 500, heightPt: 1000 };

describe('cloud OCR', () => {
  it('Google Vision: words and boxes in PDF points', async () => {
    const api = await fake((_, res) =>
      json(res, {
        responses: [
          {
            fullTextAnnotation: {
              pages: [{ blocks: [{ paragraphs: [{ words: [{ symbols: [{ text: 'IN' }, { text: 'V' }], confidence: 0.9, boundingBox: { vertices: [{ x: 100, y: 200 }, { x: 300, y: 200 }, { x: 300, y: 240 }, { x: 100, y: 240 }] } }] }] }] }],
            },
          },
        ],
      }),
    );
    const words = await ocrGoogleVision(img, { GOOGLE_VISION_URL: api.url, GOOGLE_VISION_API_KEY: 'v-key', OCR_LANGS: 'eng+fra' });
    expect(words).toEqual([{ str: 'INV', x: 50, y: 100, w: 100, h: 20, confidence: 90 }]);
    expect(api.seen[0].headers['x-goog-api-key']).toBe('v-key');
    expect(api.seen[0].body.requests[0].imageContext.languageHints).toEqual(['en', 'fr']);
    expect(api.seen[0].body.requests[0].features).toEqual([{ type: 'DOCUMENT_TEXT_DETECTION' }]);
  });

  it('Textract: signed request, WORD blocks in PDF points', async () => {
    const api = await fake((_, res) => json(res, { Blocks: [{ BlockType: 'LINE', Text: 'x' }, { BlockType: 'WORD', Text: 'Total', Confidence: 99.2, Geometry: { BoundingBox: { Left: 0.1, Top: 0.5, Width: 0.2, Height: 0.01 } } }] }));
    const words = await ocrTextract(img, { TEXTRACT_URL: `${api.url}/`, TEXTRACT_REGION: 'us-east-1', TEXTRACT_ACCESS_KEY_ID: 'AKIDEXAMPLE', TEXTRACT_SECRET_ACCESS_KEY: 'secret' });
    expect(words).toEqual([{ str: 'Total', x: 50, y: 500, w: 100, h: 10, confidence: 99 }]);
    expect(api.seen[0].headers['x-amz-target']).toBe('Textract.DetectDocumentText');
    expect(api.seen[0].headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/us-east-1\/textract\/aws4_request, SignedHeaders=content-type;host;x-amz-date;x-amz-target, Signature=[0-9a-f]{64}$/);
  });

  it('signs like AWS (post-vanilla of the AWS Signature Version 4 test suite)', () => {
    const h = signAws({
      url: 'https://example.amazonaws.com/',
      body: '',
      region: 'us-east-1',
      service: 'service',
      accessKeyId: 'AKIDEXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      headers: {},
      now: new Date('2015-08-30T12:36:00Z'),
    });
    expect(h.authorization).toBe('AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5da7c1a2acd57cee7505fc6676e4e544621c30862966e37dddb68e92efbe5d6b');
  });

  it('Azure Document Intelligence: polls the operation, polygons in PDF points', async () => {
    let polls = 0;
    const api = await fake((r, res) => {
      if (r.url.includes(':analyze')) {
        res.writeHead(202, { 'operation-location': `http://${r.headers.host}/operations/1` });
        return res.end();
      }
      polls++;
      if (polls < 2) return json(res, { status: 'running' });
      json(res, { status: 'succeeded', analyzeResult: { pages: [{ width: 1000, height: 2000, words: [{ content: 'Canada', confidence: 0.98, polygon: [100, 100, 200, 100, 200, 140, 100, 140] }] }] } });
    });
    const words = await ocrAzureDocumentIntelligence(img, { AZURE_DI_ENDPOINT: api.url, AZURE_DI_API_KEY: 'di-key' }, 1);
    expect(words).toEqual([{ str: 'Canada', x: 50, y: 50, w: 50, h: 20, confidence: 98 }]);
    expect(api.seen[0].headers['ocp-apim-subscription-key']).toBe('di-key');
    expect(api.seen[0].body.base64Source).toBe('AQID');
    expect(polls).toBe(2);
  });

  it('says why an engine cannot run', async () => {
    expect(cloudOcrProblem('google-vision', { GOOGLE_VISION_API_KEY: 'k' })).toMatch(/local only/);
    expect(cloudOcrProblem('google-vision', { AI_LOCAL_ONLY: 'false' })).toBe('Google Cloud Vision needs GOOGLE_VISION_API_KEY');
    expect(cloudOcrProblem('aws-textract', { AI_LOCAL_ONLY: 'false', TEXTRACT_REGION: 'eu-west-1' })).toBe('Amazon Textract needs TEXTRACT_ACCESS_KEY_ID, TEXTRACT_SECRET_ACCESS_KEY');
    expect(cloudOcrProblem('azure-di', { AI_LOCAL_ONLY: 'false', AZURE_DI_ENDPOINT: 'https://x.cognitiveservices.azure.com', AZURE_DI_API_KEY: 'k' })).toBeUndefined();
    await expect(ocrGoogleVision(img, { GOOGLE_VISION_API_KEY: 'k' })).rejects.toThrow(/local only/);
  });
});
