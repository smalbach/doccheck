import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
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
 * Render resolution: 4x (288 dpi). Upscaling a poor 110 dpi scan before OCR recovered more fields
 * than 2x or 3x in a comparison on the synthetic scans; on 150 dpi scans every setting was perfect.
 */
const SCALE = 4;
/** Words recognized below this confidence are dropped: on scans they are mostly speckle. */
const MIN_CONFIDENCE = 30;

let worker: Promise<Worker> | undefined;

/** One shared tesseract worker with the bundled English model; nothing is downloaded at run time. */
function getWorker(): Promise<Worker> {
  worker ??= (async () => {
    const { createWorker } = await import('tesseract.js');
    const require = createRequire(__filename);
    const langPath = join(dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0_best_int');
    const w = await createWorker('eng', 1, { langPath, gzip: true, cachePath: join(tmpdir(), 'doccheck-tesseract') });
    // PSM 6 (one uniform block) found 16 of 22 key values on degraded scans against 11 for the
    // default automatic segmentation, which drops faint cells; row grouping uses the word boxes anyway.
    await w.setParameters({ tessedit_pageseg_mode: '6' as never });
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
  const viewport = page.getViewport({ scale: SCALE });
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
            x: word.bbox.x0 / SCALE,
            y: word.bbox.y0 / SCALE,
            w: (word.bbox.x1 - word.bbox.x0) / SCALE,
            h: (word.bbox.y1 - word.bbox.y0) / SCALE,
            confidence: word.confidence,
          });
        }
      }
    }
  }
  return { words, confidence: data.confidence };
}
