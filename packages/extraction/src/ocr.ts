import { copyFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Worker } from 'tesseract.js';
import { ocrCloudImage, type PageImage } from './ocr-cloud';

/** A recognized word, in PDF points with the origin at the top-left of the page. */
export interface OcrWord {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
  confidence: number;
}

/** Minimal slice of pdf.js' page object used for rendering. */
interface RenderablePage {
  getViewport(o: { scale: number }): { width: number; height: number };
  render(o: { canvas: unknown; viewport: unknown }): { promise: Promise<void> };
}

/**
 * Settings chosen with `npm run eval:ocr` on the 120 synthetic scans (share of printed truth values
 * found in the OCR text; the text layer of the same documents finds 99.7%):
 *   English only, 4x: 82.8%   English + French, 4x: 86.6% (chosen)   English + French, 3x: 85.3%
 *   with a contrast stretch and unsharp mask before OCR: 75.1% (sharpening amplifies scan noise)
 * 4x renders at 288 dpi; upscaling a poor 110 dpi scan still helps tesseract.
 */
const DEFAULT_SCALE = 4;
/** Words recognized below this confidence are dropped: on scans they are mostly speckle. */
const MIN_CONFIDENCE = 30;

let worker: Promise<Worker> | undefined;

/** One shared tesseract worker with English and French models (CBSA accepts French invoices). */
function getWorker(): Promise<Worker> {
  worker ??= (async () => {
    const { createWorker } = await import('tesseract.js');
    const require = createRequire(__filename);
    // Language data comes from the @tesseract.js-data packages (installed with npm, nothing is
    // downloaded at run time). Each package has its own folder and tesseract.js takes a single
    // langPath, so the files are copied side by side into one folder first.
    const langs = (process.env.OCR_LANGS ?? 'eng+fra').split('+');
    const dir = join(tmpdir(), 'doccheck-tesseract');
    await mkdir(dir, { recursive: true });
    for (const code of langs) {
      const file = join(dirname(require.resolve(`@tesseract.js-data/${code}/package.json`)), '4.0.0_best_int', `${code}.traineddata.gz`);
      await copyFile(file, join(dir, `${code}.traineddata.gz`));
    }
    const w = await createWorker(langs.join('+'), 1, { langPath: dir, gzip: true, cacheMethod: 'none' });
    // PSM 6 (one uniform block): on degraded scans the default automatic segmentation drops faint
    // table cells (11 of 22 key values against 16 in a first comparison); row grouping uses the word boxes anyway.
    await w.setParameters({ tessedit_pageseg_mode: (process.env.OCR_PSM ?? '6') as never });
    return w;
  })();
  return worker;
}

/** Stops the OCR worker so a CLI can exit. Safe to call when OCR never ran. */
export async function terminateOcr(): Promise<void> {
  const w = worker;
  worker = undefined;
  if (w) await (await w).terminate();
}

/**
 * OCR engine: tesseract (default, in-process, runs anywhere) or unlimited (Baidu Unlimited-OCR on
 * Apple Silicon, served by scripts/ocr-server.py at OCR_URL). On the 120 synthetic scans, unlimited
 * finds 96.8% of the printed truth values against 86.6% for tesseract (94.2% vs 69.3% at 110 dpi).
 * The cloud engines (google-vision, aws-textract, azure-di) send the page image to that service and
 * need "local only" off (AI_LOCAL_ONLY=false); see ocr-cloud.ts.
 */
export const OCR_ENGINES = ['tesseract', 'unlimited', 'google-vision', 'aws-textract', 'azure-di'] as const;
export type OcrEngine = (typeof OCR_ENGINES)[number];
export const CLOUD_OCR_ENGINES: readonly OcrEngine[] = ['google-vision', 'aws-textract', 'azure-di'];
export const ocrEngine = (env: NodeJS.ProcessEnv = process.env): OcrEngine => (OCR_ENGINES as readonly string[]).includes(env.OCR_ENGINE ?? '') ? (env.OCR_ENGINE as OcrEngine) : 'tesseract';

/** Renders a PDF page and recognizes its text with the configured engine. */
export async function ocrPage(page: RenderablePage): Promise<{ words: OcrWord[]; confidence?: number }> {
  const engine = ocrEngine();
  if (engine === 'unlimited') return ocrPageUnlimited(page);
  if (engine === 'tesseract') return ocrPageTesseract(page);
  return { words: await ocrCloudImage(engine, await renderPage(page, CLOUD_SCALE)) };
}

/** Scale pages are rendered at for the cloud engines: 216 dpi, well inside their size limits. */
const CLOUD_SCALE = 3;

async function renderPage(page: RenderablePage, scale: number): Promise<PageImage> {
  const { createCanvas } = await import('@napi-rs/canvas');
  const points = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  await page.render({ canvas, viewport }).promise;
  return { png: await canvas.encode('png'), widthPx: canvas.width, heightPx: canvas.height, widthPt: points.width, heightPt: points.height };
}

const unescapeHtml = (s: string) =>
  s.replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/**
 * Unlimited-OCR output -> one OcrWord per text line, in PDF points. Each region is
 * "<|det|>type [x1, y1, x2, y2]<|/det|>content" with coordinates 0-1000 of the page. A table becomes
 * one line per row, cells joined by " | " (its box is split evenly between rows), so the extraction
 * model reads columns and the rows still group with the text beside them. A region repeated verbatim
 * (the model sometimes loops) is kept once.
 */
export function parseUnlimitedOcr(text: string, pageWidth: number, pageHeight: number): OcrWord[] {
  const words: OcrWord[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(/<\|det\|>(\w+) \[(\d+), (\d+), (\d+), (\d+)\]<\|\/det\|>([\s\S]*?)(?=<\|det\|>|$)/g)) {
    const [x1, y1, x2, y2] = [m[2], m[3], m[4], m[5]].map(Number);
    const body = m[6].trim();
    if (!body || seen.has(body)) continue;
    seen.add(body);
    const rows = body.includes('<tr')
      ? [...body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((r) =>
          [...r[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => unescapeHtml(c[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())).join(' | '),
        )
      : [unescapeHtml(body.replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ').trim())];
    // A text region can span several lines of its own.
    const lines = rows.flatMap((r) => r.split('\n')).map((l) => l.trim());
    lines.forEach((line, i) => {
      if (!line.replace(/[\s|]/g, '')) return;
      const top = y1 + ((y2 - y1) * i) / lines.length;
      const bottom = y1 + ((y2 - y1) * (i + 1)) / lines.length;
      words.push({ str: line, x: (x1 / 1000) * pageWidth, y: (top / 1000) * pageHeight, w: ((x2 - x1) / 1000) * pageWidth, h: ((bottom - top) / 1000) * pageHeight, confidence: 100 });
    });
  }
  return words;
}

/** Scale the page is rendered at for Unlimited-OCR: 144 dpi, the size it was measured with. */
const UNLIMITED_SCALE = 2;

async function ocrPageUnlimited(page: RenderablePage): Promise<{ words: OcrWord[] }> {
  const { createCanvas } = await import('@napi-rs/canvas');
  const points = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: UNLIMITED_SCALE });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  await page.render({ canvas, viewport }).promise;
  const url = (process.env.OCR_URL || 'http://127.0.0.1:8765').replace(/\/$/, '');
  let res: Response;
  try {
    res = await fetch(`${url}/ocr`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: await canvas.encode('png') });
  } catch (err) {
    throw new Error(`OCR server is not reachable at ${url} (start it with scripts/ocr-server.py): ${err instanceof Error ? err.message : String(err)}`);
  }
  const body = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
  if (!res.ok || typeof body.text !== 'string') throw new Error(`OCR server ${res.status}: ${body.error ?? 'no text'}`);
  return { words: parseUnlimitedOcr(body.text, points.width, points.height) };
}

/** Renders a PDF page and recognizes its words with tesseract. */
async function ocrPageTesseract(page: RenderablePage): Promise<{ words: OcrWord[]; confidence: number }> {
  const { createCanvas } = await import('@napi-rs/canvas');
  // Read per page so an admin change applies without a restart; the same value maps boxes back to points.
  const scale = Number(process.env.OCR_SCALE ?? DEFAULT_SCALE);
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  await page.render({ canvas, viewport }).promise;
  const png = await canvas.encode('png');

  const w = await getWorker();
  // rotateAuto deskews before recognition; boxes then refer to the deskewed page, off by a few
  // points at most for the small angles of a feeder scan, which is fine for highlighting.
  const { data } = await w.recognize(png, { rotateAuto: true }, { blocks: true });
  const words: OcrWord[] = [];
  for (const block of data.blocks ?? []) {
    for (const para of block.paragraphs) {
      for (const line of para.lines) {
        for (const word of line.words) {
          if (word.confidence < MIN_CONFIDENCE || !word.text.trim()) continue;
          words.push({
            str: word.text,
            x: word.bbox.x0 / scale,
            y: word.bbox.y0 / scale,
            w: (word.bbox.x1 - word.bbox.x0) / scale,
            h: (word.bbox.y1 - word.bbox.y0) / scale,
            confidence: word.confidence,
          });
        }
      }
    }
  }
  return { words, confidence: data.confidence };
}

