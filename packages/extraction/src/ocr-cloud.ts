import { assertAiAllowed } from '@doccheck/schemas';
import { createHash, createHmac } from 'node:crypto';
import type { OcrWord } from './ocr';

/** A rendered page: PNG bytes, its size in pixels, and the page size in PDF points. */
export interface PageImage {
  png: Uint8Array;
  widthPx: number;
  heightPx: number;
  widthPt: number;
  heightPt: number;
}

const ISO_639_1: Record<string, string> = { eng: 'en', fra: 'fr', spa: 'es', deu: 'de' };
const languageHints = (env: NodeJS.ProcessEnv) => (env.OCR_LANGS ?? 'eng+fra').split('+').flatMap((c) => (ISO_639_1[c] ? [ISO_639_1[c]] : []));

const need = (env: NodeJS.ProcessEnv, name: string, engine: string) => {
  const v = env[name];
  if (!v) throw new Error(`OCR engine ${engine} needs ${name}`);
  return v;
};

async function call(who: string, url: string, init: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(120_000) });
  } catch (err) {
    throw new Error(`${who} is not reachable at ${new URL(url).origin}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok && res.status !== 202) throw new Error(`${who} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res;
}

/** Axis-aligned box around points in pixels, in PDF points. */
function boxOf(points: { x?: number; y?: number }[], sx: number, sy: number) {
  const xs = points.map((p) => p.x ?? 0);
  const ys = points.map((p) => p.y ?? 0);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return { x: x0 * sx, y: y0 * sy, w: (x1 - x0) * sx, h: (y1 - y0) * sy };
}

interface VisionResponse {
  responses?: {
    error?: { message?: string };
    fullTextAnnotation?: {
      pages?: { blocks?: { paragraphs?: { words?: { symbols?: { text?: string }[]; boundingBox?: { vertices?: { x?: number; y?: number }[] }; confidence?: number }[] }[] }[] }[];
    };
  }[];
}

/** Google Cloud Vision DOCUMENT_TEXT_DETECTION with an API key (GOOGLE_VISION_API_KEY). */
export async function ocrGoogleVision(img: PageImage, env: NodeJS.ProcessEnv = process.env): Promise<OcrWord[]> {
  const url = env.GOOGLE_VISION_URL || 'https://vision.googleapis.com';
  assertAiAllowed('Google Cloud Vision', url, env);
  const key = need(env, 'GOOGLE_VISION_API_KEY', 'google-vision');
  const res = await call('Google Cloud Vision', `${url.replace(/\/$/, '')}/v1/images:annotate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      requests: [{ image: { content: Buffer.from(img.png).toString('base64') }, features: [{ type: 'DOCUMENT_TEXT_DETECTION' }], imageContext: { languageHints: languageHints(env) } }],
    }),
  });
  const body = (await res.json()) as VisionResponse;
  const r = body.responses?.[0];
  if (r?.error) throw new Error(`Google Cloud Vision: ${r.error.message ?? 'error'}`);
  const [sx, sy] = [img.widthPt / img.widthPx, img.heightPt / img.heightPx];
  const words: OcrWord[] = [];
  for (const page of r?.fullTextAnnotation?.pages ?? [])
    for (const block of page.blocks ?? [])
      for (const para of block.paragraphs ?? [])
        for (const word of para.words ?? []) {
          const str = (word.symbols ?? []).map((s) => s.text ?? '').join('');
          if (!str.trim()) continue;
          words.push({ str, ...boxOf(word.boundingBox?.vertices ?? [], sx, sy), confidence: Math.round((word.confidence ?? 1) * 100) });
        }
  return words;
}

const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
const hmac = (key: string | Buffer, data: string) => createHmac('sha256', key).update(data).digest();

/** AWS Signature Version 4 headers for a POST of `body` to `url`. */
export function signAws(opts: { url: string; body: string; region: string; service: string; accessKeyId: string; secretAccessKey: string; sessionToken?: string; headers: Record<string, string>; now?: Date }) {
  const u = new URL(opts.url);
  const amzDate = (opts.now ?? new Date()).toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const headers: Record<string, string> = { ...opts.headers, host: u.host, 'x-amz-date': amzDate, ...(opts.sessionToken ? { 'x-amz-security-token': opts.sessionToken } : {}) };
  const names = Object.keys(headers)
    .map((h) => h.toLowerCase())
    .sort();
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v.trim()]));
  const signedHeaders = names.join(';');
  const canonical = ['POST', u.pathname || '/', u.search.slice(1), names.map((n) => `${n}:${lower[n]}\n`).join(''), signedHeaders, sha256(opts.body)].join('\n');
  const scope = `${day}/${opts.region}/${opts.service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${opts.secretAccessKey}`, day), opts.region), opts.service), 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(toSign).digest('hex');
  return { ...headers, authorization: `AWS4-HMAC-SHA256 Credential=${opts.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}` };
}

interface TextractResponse {
  Blocks?: { BlockType?: string; Text?: string; Confidence?: number; Geometry?: { BoundingBox?: { Width: number; Height: number; Left: number; Top: number } } }[];
}

/** Textract credentials: TEXTRACT_REGION / _ACCESS_KEY_ID / _SECRET_ACCESS_KEY, else the usual AWS_* variables. */
const textractCreds = (env: NodeJS.ProcessEnv) => ({
  region: env.TEXTRACT_REGION || env.AWS_REGION,
  accessKeyId: env.TEXTRACT_ACCESS_KEY_ID || env.AWS_ACCESS_KEY_ID,
  secretAccessKey: env.TEXTRACT_SECRET_ACCESS_KEY || env.AWS_SECRET_ACCESS_KEY,
  sessionToken: env.TEXTRACT_ACCESS_KEY_ID ? undefined : env.AWS_SESSION_TOKEN || undefined,
});

/** Where each cloud engine sends pages, and the variables it needs. */
function cloudOcrTarget(engine: string, env: NodeJS.ProcessEnv): { name: string; url?: string; missing: string[] } {
  if (engine === 'google-vision') return { name: 'Google Cloud Vision', url: env.GOOGLE_VISION_URL || 'https://vision.googleapis.com', missing: env.GOOGLE_VISION_API_KEY ? [] : ['GOOGLE_VISION_API_KEY'] };
  if (engine === 'aws-textract') {
    const c = textractCreds(env);
    const missing = [!c.region && 'TEXTRACT_REGION', !c.accessKeyId && 'TEXTRACT_ACCESS_KEY_ID', !c.secretAccessKey && 'TEXTRACT_SECRET_ACCESS_KEY'].filter((x): x is string => !!x);
    return { name: 'Amazon Textract', url: env.TEXTRACT_URL || (c.region ? `https://textract.${c.region}.amazonaws.com/` : undefined), missing };
  }
  return { name: 'Azure Document Intelligence', url: env.AZURE_DI_ENDPOINT, missing: [!env.AZURE_DI_ENDPOINT && 'AZURE_DI_ENDPOINT', !env.AZURE_DI_API_KEY && 'AZURE_DI_API_KEY'].filter((x): x is string => !!x) };
}

/** Why a cloud OCR engine cannot run with `env` (outside service while local only, missing credentials), or undefined. */
export function cloudOcrProblem(engine: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const t = cloudOcrTarget(engine, env);
  try {
    assertAiAllowed(t.name, t.url, env);
  } catch (err) {
    return (err as Error).message;
  }
  return t.missing.length ? `${t.name} needs ${t.missing.join(', ')}` : undefined;
}

/** Amazon Textract DetectDocumentText (see textractCreds). */
export async function ocrTextract(img: PageImage, env: NodeJS.ProcessEnv = process.env): Promise<OcrWord[]> {
  const c = textractCreds(env);
  const region = c.region ?? need(env, 'TEXTRACT_REGION', 'aws-textract');
  const url = env.TEXTRACT_URL || `https://textract.${region}.amazonaws.com/`;
  assertAiAllowed('Amazon Textract', url, env);
  const body = JSON.stringify({ Document: { Bytes: Buffer.from(img.png).toString('base64') } });
  const headers = signAws({
    url,
    body,
    region,
    service: 'textract',
    accessKeyId: c.accessKeyId ?? need(env, 'TEXTRACT_ACCESS_KEY_ID', 'aws-textract'),
    secretAccessKey: c.secretAccessKey ?? need(env, 'TEXTRACT_SECRET_ACCESS_KEY', 'aws-textract'),
    sessionToken: c.sessionToken,
    headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'Textract.DetectDocumentText' },
  });
  const res = await call('Amazon Textract', url, { method: 'POST', headers, body });
  const out = (await res.json()) as TextractResponse;
  return (out.Blocks ?? []).flatMap((b) => {
    const box = b.Geometry?.BoundingBox;
    if (b.BlockType !== 'WORD' || !b.Text?.trim() || !box) return [];
    return [{ str: b.Text, x: box.Left * img.widthPt, y: box.Top * img.heightPt, w: box.Width * img.widthPt, h: box.Height * img.heightPt, confidence: Math.round(b.Confidence ?? 100) }];
  });
}

interface AzureAnalyze {
  status?: string;
  error?: { message?: string };
  analyzeResult?: { pages?: { width?: number; height?: number; words?: { content?: string; polygon?: number[]; confidence?: number }[] }[] };
}

/** Azure AI Document Intelligence, prebuilt-read model (AZURE_DI_ENDPOINT, AZURE_DI_API_KEY). Polls until the analysis is done. */
export async function ocrAzureDocumentIntelligence(img: PageImage, env: NodeJS.ProcessEnv = process.env, pollMs = 1000): Promise<OcrWord[]> {
  const endpoint = need(env, 'AZURE_DI_ENDPOINT', 'azure-di').replace(/\/$/, '');
  assertAiAllowed('Azure Document Intelligence', endpoint, env);
  const key = need(env, 'AZURE_DI_API_KEY', 'azure-di');
  const res = await call('Azure Document Intelligence', `${endpoint}/documentintelligence/documentModels/prebuilt-read:analyze?api-version=2024-11-30`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'ocp-apim-subscription-key': key },
    body: JSON.stringify({ base64Source: Buffer.from(img.png).toString('base64') }),
  });
  const location = res.headers.get('operation-location');
  let result: AzureAnalyze = location ? {} : ((await res.json()) as AzureAnalyze);
  for (let i = 0; location && i < 120; i++) {
    const poll = await call('Azure Document Intelligence', location, { headers: { 'ocp-apim-subscription-key': key } });
    result = (await poll.json()) as AzureAnalyze;
    if (result.status === 'succeeded' || result.status === 'failed') break;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  if (result.status === 'failed') throw new Error(`Azure Document Intelligence: ${result.error?.message ?? 'analysis failed'}`);
  if (location && result.status !== 'succeeded') throw new Error('Azure Document Intelligence did not finish in time');
  const page = result.analyzeResult?.pages?.[0];
  if (!page) return [];
  const [sx, sy] = [img.widthPt / (page.width || img.widthPx), img.heightPt / (page.height || img.heightPx)];
  return (page.words ?? []).flatMap((w) => {
    if (!w.content?.trim() || !w.polygon?.length) return [];
    const points = [];
    for (let i = 0; i + 1 < w.polygon.length; i += 2) points.push({ x: w.polygon[i], y: w.polygon[i + 1] });
    return [{ str: w.content, ...boxOf(points, sx, sy), confidence: Math.round((w.confidence ?? 1) * 100) }];
  });
}

/** Runs one cloud engine on a page image. */
export function ocrCloudImage(engine: string, img: PageImage, env: NodeJS.ProcessEnv = process.env): Promise<OcrWord[]> {
  if (engine === 'google-vision') return ocrGoogleVision(img, env);
  if (engine === 'aws-textract') return ocrTextract(img, env);
  if (engine === 'azure-di') return ocrAzureDocumentIntelligence(img, env);
  throw new Error(`Not a cloud OCR engine: ${engine}`);
}

/** A small page with printed text, for testing an OCR service from the settings page. */
export async function ocrTestImage(text = 'DocCheck OCR test 12345'): Promise<PageImage> {
  const { createCanvas } = await import('@napi-rs/canvas');
  const canvas = createCanvas(1200, 300);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 1200, 300);
  ctx.fillStyle = '#000';
  ctx.font = '64px sans-serif';
  ctx.fillText(text, 60, 170);
  return { png: await canvas.encode('png'), widthPx: 1200, heightPx: 300, widthPt: 400, heightPt: 100 };
}
