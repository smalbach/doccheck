import { fullFrame, quadArea, type Quad, type RasterImage } from './rasterImage';

export interface DetectedQuad {
  quad: Quad;
  /** False when nothing page-like was found and `quad` is the whole frame. */
  found: boolean;
}

/** Below this the two halves of the histogram are too alike to tell a page from its background. */
const MIN_CONTRAST = 28;
/** The page must cover at least this much of the frame… */
const MIN_COVER = 0.12;
/** …and a quad this close to the whole frame says nothing the full frame does not. */
const MAX_COVER = 0.97;
/** How much of the quad the region must fill (rows filled across, so text does not leave holes). */
const MIN_FILL = 0.85;

/**
 * Finds the corners of a page in a photo: grayscale, blur away text and texture, split bright from
 * dark with Otsu's threshold, take the largest connected region of each polarity (a light page on a
 * darker surface, or the other way round), and read its corners off the extreme points: smallest
 * and largest x+y (top-left, bottom-right) and x−y (bottom-left, top-right). A region counts only
 * if it is big enough, not the whole frame, convex, and fills the quad its corners make. Meant for
 * a downscaled frame (a few hundred pixels across); returns coordinates in the given image.
 */
export function detectDocumentQuad(image: RasterImage): DetectedQuad {
  const { width, height } = image;
  const fallback = { quad: fullFrame(width, height), found: false };
  if (width < 8 || height < 8) return fallback;

  const gray = blur(grayscale(image), width, height, Math.max(1, Math.round(Math.min(width, height) / 80)));
  const split = otsu(gray);
  if (split.contrast < MIN_CONTRAST) return fallback;

  let best: { quad: Quad; area: number } | undefined;
  for (const bright of [true, false]) {
    const region = largestRegion(gray, width, height, (v) => (bright ? v > split.threshold : v <= split.threshold));
    if (!region) continue;
    const candidate = regionQuad(region, width, height);
    if (candidate && (!best || candidate.area > best.area)) best = candidate;
  }
  return best ? { quad: best.quad, found: true } : fallback;
}

function grayscale({ data, width, height }: RasterImage): Float32Array {
  const gray = new Float32Array(width * height);
  for (let i = 0; i < gray.length; i++) gray[i] = 0.299 * data[i * 4]! + 0.587 * data[i * 4 + 1]! + 0.114 * data[i * 4 + 2]!;
  return gray;
}

/** Two passes of a separable box blur (close to a Gaussian). */
function blur(src: Float32Array, width: number, height: number, radius: number): Float32Array {
  let a = src;
  for (let pass = 0; pass < 2; pass++) {
    a = boxPass(a, width, height, radius, true);
    a = boxPass(a, width, height, radius, false);
  }
  return a;
}

function boxPass(src: Float32Array, width: number, height: number, r: number, horizontal: boolean): Float32Array {
  const out = new Float32Array(src.length);
  const lines = horizontal ? height : width;
  const len = horizontal ? width : height;
  const at = (line: number, i: number) => (horizontal ? line * width + i : i * width + line);
  for (let line = 0; line < lines; line++) {
    let sum = 0;
    // Edge pixels repeat beyond the border.
    for (let i = -r; i <= r; i++) sum += src[at(line, Math.min(len - 1, Math.max(0, i)))]!;
    for (let i = 0; i < len; i++) {
      out[at(line, i)] = sum / (2 * r + 1);
      sum += src[at(line, Math.min(len - 1, i + r + 1))]! - src[at(line, Math.max(0, i - r))]!;
    }
  }
  return out;
}

/** Otsu's threshold, plus how far apart the two classes' means are. */
function otsu(gray: Float32Array): { threshold: number; contrast: number } {
  const hist = new Float64Array(256);
  for (const v of gray) hist[Math.min(255, Math.max(0, Math.round(v)))]!++;
  const total = gray.length;
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * hist[i]!;
  let weightLow = 0;
  let sumLow = 0;
  let best = { threshold: 0, contrast: 0, variance: -1 };
  for (let t = 0; t < 255; t++) {
    weightLow += hist[t]!;
    sumLow += t * hist[t]!;
    const weightHigh = total - weightLow;
    if (weightLow === 0 || weightHigh === 0) continue;
    const meanLow = sumLow / weightLow;
    const meanHigh = (sumAll - sumLow) / weightHigh;
    const variance = weightLow * weightHigh * (meanHigh - meanLow) ** 2;
    if (variance > best.variance) best = { threshold: t, contrast: meanHigh - meanLow, variance };
  }
  return best;
}

interface Region {
  size: number;
  /** Per row, the leftmost and rightmost pixel (−1 for rows the region does not reach). */
  minX: Int32Array;
  maxX: Int32Array;
  corners: Quad;
}

/** The largest 4-connected region of pixels passing `inside`, with its extreme points. */
function largestRegion(gray: Float32Array, width: number, height: number, inside: (v: number) => boolean): Region | undefined {
  const seen = new Uint8Array(gray.length);
  const stack = new Int32Array(gray.length);
  let best: { seed: number; size: number } | undefined;
  for (let start = 0; start < gray.length; start++) {
    if (seen[start] || !inside(gray[start]!)) continue;
    let size = 0;
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    while (top > 0) {
      const p = stack[--top]!;
      size++;
      const x = p % width;
      const neighbours = [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, p - width, p + width];
      for (const q of neighbours) {
        if (q < 0 || q >= gray.length || seen[q] || !inside(gray[q]!)) continue;
        seen[q] = 1;
        stack[top++] = q;
      }
    }
    if (!best || size > best.size) best = { seed: start, size };
  }
  if (!best) return undefined;

  // Walk the winning region again to collect its rows and corners.
  const mark = new Uint8Array(gray.length);
  const minX = new Int32Array(height).fill(-1);
  const maxX = new Int32Array(height).fill(-1);
  let tl = best.seed;
  let br = best.seed;
  let tr = best.seed;
  let bl = best.seed;
  const sumOf = (p: number) => (p % width) + Math.floor(p / width);
  const diffOf = (p: number) => (p % width) - Math.floor(p / width);
  let top = 0;
  stack[top++] = best.seed;
  mark[best.seed] = 1;
  while (top > 0) {
    const p = stack[--top]!;
    const x = p % width;
    const y = (p - x) / width;
    if (minX[y] === -1 || x < minX[y]!) minX[y] = x;
    if (x > maxX[y]!) maxX[y] = x;
    if (sumOf(p) < sumOf(tl)) tl = p;
    if (sumOf(p) > sumOf(br)) br = p;
    if (diffOf(p) > diffOf(tr)) tr = p;
    if (diffOf(p) < diffOf(bl)) bl = p;
    const neighbours = [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, p - width, p + width];
    for (const q of neighbours) {
      if (q < 0 || q >= gray.length || mark[q] || !inside(gray[q]!)) continue;
      mark[q] = 1;
      stack[top++] = q;
    }
  }
  const point = (p: number) => ({ x: p % width, y: Math.floor(p / width) });
  return { size: best.size, minX, maxX, corners: [point(tl), point(tr), point(br), point(bl)] };
}

function regionQuad(region: Region, width: number, height: number): { quad: Quad; area: number } | undefined {
  const frame = width * height;
  const area = quadArea(region.corners);
  if (region.size < MIN_COVER * frame || area < MIN_COVER * frame || area > MAX_COVER * frame) return undefined;
  if (!isConvex(region.corners)) return undefined;
  let filled = 0;
  for (let y = 0; y < height; y++) if (region.minX[y]! >= 0) filled += region.maxX[y]! - region.minX[y]! + 1;
  // A quad drawn through pixel centres leaves out about half a pixel along its edges.
  const ratio = filled / (area + perimeter(region.corners) / 2);
  if (ratio < MIN_FILL || ratio > 1 / MIN_FILL) return undefined;
  return { quad: region.corners, area };
}

function isConvex(quad: Quad): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = quad[i]!;
    const b = quad[(i + 1) % 4]!;
    const c = quad[(i + 2) % 4]!;
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (cross === 0) return false;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return true;
}

function perimeter(quad: Quad): number {
  let sum = 0;
  for (let i = 0; i < 4; i++) sum += Math.hypot(quad[i]!.x - quad[(i + 1) % 4]!.x, quad[i]!.y - quad[(i + 1) % 4]!.y);
  return sum;
}
