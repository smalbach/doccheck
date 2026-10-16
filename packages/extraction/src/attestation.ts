import type { Attestation } from '@doccheck/schemas';
import type { BBox, PdfText } from './pdf-text';

/**
 * Is the paper signed or stamped? A layout check, no model: each page is rendered, the text the PDF
 * (or OCR) already read is masked out, and so are the long straight runs of table borders. What
 * ink is left near a signature label ("Signature", "Signed", "Authorized", "For and on behalf of")
 * is a handwritten or drawn signature; a patch of saturated colour (blue, red, violet) there is a
 * stamp. Coloured logos at the top of a page are not near a signature label and are not counted.
 *
 * It answers "something is drawn where the signature goes", not "this is a valid signature".
 */

const SIGN_LABEL = /\b(signature|signed|sign here|authori[sz]ed|for and on behalf|on behalf of|as agent|for the carrier|signatory|sign[ée]|firma)\b/i;
/** Render scale (144 dpi): enough to tell strokes from noise, cheap to scan. */
const SCALE = 2;
/** Runs longer than this many pixels, straight, are table borders or underlines. */
const RULE_RUN = 36;
/** Area around a signature label searched for ink, in points: left, above, right, below. */
const REACH = { left: 60, above: 70, right: 260, below: 90 };
/** Ink pixels needed (at SCALE) for a signature, and coloured pixels for a stamp. */
const MIN_SIGNATURE_PX = 120;
const MIN_STAMP_PX = 400;

interface RenderablePage {
  getViewport(o: { scale: number }): { width: number; height: number };
  render(o: { canvas: unknown; viewport: unknown }): { promise: Promise<void> };
}

interface PageInk extends Ink {
  box: BBox;
}

/** Hue of a saturated pixel: stamps are mostly red or violet ink, signatures blue or black. */
const hueGroup = (r: number, g: number, b: number): 'red' | 'blue' | 'other' => {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  hue = (hue * 60 + 360) % 360;
  return hue < 25 || hue >= 290 ? 'red' : hue >= 190 ? 'blue' : 'other';
};

export interface Ink {
  /** Strokes that are neither text, nor table rules, nor the stamp. */
  signature: number;
  /** Pixels of the stamp: a compact patch of one saturated colour; 0 when there is none. */
  stamp: number;
}

/** Ink inside `box` (points) of a rendered page, with the text already read masked out. */
export function inkIn(rgba: Uint8ClampedArray, width: number, height: number, textBoxes: BBox[], box: BBox, scale = SCALE): Ink {
  const x0 = Math.max(0, Math.floor(box[0] * scale));
  const y0 = Math.max(0, Math.floor(box[1] * scale));
  const x1 = Math.min(width, Math.ceil(box[2] * scale));
  const y1 = Math.min(height, Math.ceil(box[3] * scale));
  if (x1 <= x0 || y1 <= y0) return { signature: 0, stamp: 0 };
  const w = x1 - x0;
  const h = y1 - y0;
  // 0 paper, 1 ink, 2 a rule; colour: 0 none, 1 red, 2 blue, 3 other.
  const dark = new Uint8Array(w * h);
  const colour = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = ((y0 + y) * width + (x0 + x)) * 4;
      const [r, g, b] = [rgba[i], rgba[i + 1], rgba[i + 2]];
      const saturated = Math.max(r, g, b) - Math.min(r, g, b) > 70 && Math.max(r, g, b) > 60;
      if (saturated) colour[y * w + x] = { red: 1, blue: 2, other: 3 }[hueGroup(r, g, b)];
      if ((r + g + b) / 3 < 150 || saturated) dark[y * w + x] = 1;
    }
  }
  for (const [bx0, by0, bx1, by1] of textBoxes) {
    const tx0 = Math.max(x0, Math.floor((bx0 - 1) * scale));
    const ty0 = Math.max(y0, Math.floor((by0 - 1) * scale));
    const tx1 = Math.min(x1, Math.ceil((bx1 + 1) * scale));
    const ty1 = Math.min(y1, Math.ceil((by1 + 1) * scale));
    for (let y = ty0; y < ty1; y++) for (let x = tx0; x < tx1; x++) dark[(y - y0) * w + (x - x0)] = 0;
  }
  // Long straight runs: borders, underlines, the signature line itself.
  const clearRuns = (horizontal: boolean) => {
    const outer = horizontal ? h : w;
    const inner = horizontal ? w : h;
    for (let o = 0; o < outer; o++) {
      let start = -1;
      for (let k = 0; k <= inner; k++) {
        const on = k < inner && dark[horizontal ? o * w + k : k * w + o] === 1;
        if (on && start < 0) start = k;
        if (!on && start >= 0) {
          if (k - start >= RULE_RUN) for (let z = start; z < k; z++) dark[horizontal ? o * w + z : z * w + o] = 2;
          start = -1;
        }
      }
    }
  };
  clearRuns(true);
  clearRuns(false);
  let ink = 0;
  const groups = [1, 2, 3].map(() => ({ n: 0, x0: Infinity, y0: Infinity, x1: -1, y1: -1 }));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (dark[i] !== 1) continue;
      ink++;
      const c = colour[i];
      if (!c) continue;
      const g = groups[c - 1];
      g.n++;
      g.x0 = Math.min(g.x0, x);
      g.y0 = Math.min(g.y0, y);
      g.x1 = Math.max(g.x1, x);
      g.y1 = Math.max(g.y1, y);
    }
  }
  // A stamp is compact: at least 30 points each way and not much wider than tall. A signature is wide and flat.
  const stamp = groups
    .filter((g) => {
      const gw = (g.x1 - g.x0 + 1) / scale;
      const gh = (g.y1 - g.y0 + 1) / scale;
      return g.n >= MIN_STAMP_PX && gw >= 30 && gh >= 30 && gw / gh >= 0.5 && gw / gh <= 2;
    })
    .sort((a, b) => b.n - a.n)[0];
  return { signature: ink - (stamp?.n ?? 0), stamp: stamp?.n ?? 0 };
}

/** Signature regions of a page: around each signature label; none when the page has no label. */
function signatureRegions(lines: PdfText['lines'], page: number): BBox[] {
  return lines
    .filter((l) => l.page === page && SIGN_LABEL.test(l.text))
    .map((l) => [l.bbox[0] - REACH.left, l.bbox[1] - REACH.above, l.bbox[0] + REACH.right, l.bbox[3] + REACH.below] as BBox);
}

/**
 * Looks for a signature and a stamp on the given pages of a PDF (default: all, last first), using the
 * lines already read from it (text layer or OCR) to mask text. A page with no signature label is
 * checked in its bottom third.
 */
export async function detectAttestation(pdfBytes: Uint8Array, text: PdfText, pages?: readonly number[]): Promise<Attestation> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { createCanvas } = await import('@napi-rs/canvas');
  const task = pdfjs.getDocument({ data: new Uint8Array(pdfBytes), verbosity: 0 });
  const doc = await task.promise;
  try {
    const order = (pages?.length ? [...pages] : Array.from({ length: doc.numPages }, (_, i) => i + 1)).filter((p) => p <= doc.numPages).reverse().slice(0, 4);
    let best: (PageInk & { page: number; labelled: boolean }) | undefined;
    for (const p of order) {
      const page = (await doc.getPage(p)) as unknown as RenderablePage;
      const points = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: SCALE });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      await page.render({ canvas, viewport }).promise;
      const rgba = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      const boxes = text.lines.filter((l) => l.page === p).map((l) => l.bbox);
      const regions = signatureRegions(text.lines, p);
      const labelled = regions.length > 0;
      const search = labelled ? regions : [[0, points.height * 0.66, points.width, points.height] as BBox];
      for (const box of search) {
        const found = { ...inkIn(new Uint8ClampedArray(rgba), canvas.width, canvas.height, boxes, box), box, page: p, labelled };
        const score = (f: PageInk) => Math.min(f.signature, MIN_SIGNATURE_PX) + Math.min(f.stamp, MIN_STAMP_PX) + f.signature / 1e6;
        if (!best || score(found) > score(best)) best = found;
      }
      if (best && best.signature >= MIN_SIGNATURE_PX && best.stamp >= MIN_STAMP_PX) break;
    }
    if (!best) return { signature: false, stamp: false, signatureBlock: false };
    const r = (n: number) => Math.round(n * 10) / 10;
    return {
      signature: best.signature >= MIN_SIGNATURE_PX,
      stamp: best.stamp >= MIN_STAMP_PX,
      page: best.page,
      bbox: best.box.map((n) => r(Math.max(0, n))) as BBox,
      signatureBlock: best.labelled,
    };
  } finally {
    await task.destroy();
  }
}
