import { copyFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Worker } from 'tesseract.js';

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

/** Renders a PDF page and recognizes its words with tesseract. */
export async function ocrPage(page: RenderablePage): Promise<{ words: OcrWord[]; confidence: number }> {
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

