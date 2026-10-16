import type { Point, Quad, RasterImage } from './rasterImage';

/** A 3x3 projective transform, row-major. */
export type Homography = readonly [number, number, number, number, number, number, number, number, number];

/**
 * The transform that maps each `from` point onto the `to` point with the same index. The ninth
 * coefficient is fixed at 1, leaving 8 unknowns for the 8 equations of 4 point pairs.
 */
export function solveHomography(from: Quad, to: Quad): Homography {
  const rows: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i]!;
    const { x: u, y: v } = to[i]!;
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  const h = solveLinear(rows);
  return [h[0]!, h[1]!, h[2]!, h[3]!, h[4]!, h[5]!, h[6]!, h[7]!, 1];
}

/** Gaussian elimination with partial pivoting on an augmented n x (n+1) matrix. */
function solveLinear(m: number[][]): number[] {
  const n = m.length;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r]![col]!) > Math.abs(m[pivot]![col]!)) pivot = r;
    if (Math.abs(m[pivot]![col]!) < 1e-12) throw new Error('Degenerate quadrilateral');
    [m[col], m[pivot]] = [m[pivot]!, m[col]!];
    const row = m[col]!;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const other = m[r]!;
      const factor = other[col]! / row[col]!;
      if (factor === 0) continue;
      for (let c = col; c <= n; c++) other[c]! -= factor * row[c]!;
    }
  }
  return m.map((row, i) => row[n]! / row[i]!);
}

export function applyHomography(h: Homography, { x, y }: Point): Point {
  const w = h[6] * x + h[7] * y + h[8];
  return { x: (h[0] * x + h[1] * y + h[2]) / w, y: (h[3] * x + h[4] * y + h[5]) / w };
}

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Output size for a crop: the longer of each pair of opposite edges, scaled down to fit `maxSide`. */
export function cropSize([tl, tr, br, bl]: Quad, maxSide = Infinity): { width: number; height: number } {
  const width = Math.max(distance(tl, tr), distance(bl, br));
  const height = Math.max(distance(tl, bl), distance(tr, br));
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * The region inside `quad` (corners clockwise from top-left) straightened into a width x height
 * rectangle. Each output pixel is mapped back into the source and sampled bilinearly, so the
 * result has no holes whichever way the page was tilted.
 */
export function warpPerspective(source: RasterImage, quad: Quad, width: number, height: number): RasterImage {
  const rect: Quad = [
    { x: 0, y: 0 },
    { x: width - 1, y: 0 },
    { x: width - 1, y: height - 1 },
    { x: 0, y: height - 1 },
  ];
  const h = solveHomography(rect, quad);
  const out = new Uint8ClampedArray(width * height * 4);
  const { data, width: sw, height: sh } = source;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const w = h[6] * x + h[7] * y + h[8];
      const sx = Math.min(sw - 1, Math.max(0, (h[0] * x + h[1] * y + h[2]) / w));
      const sy = Math.min(sh - 1, Math.max(0, (h[3] * x + h[4] * y + h[5]) / w));
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(sw - 1, x0 + 1);
      const y1 = Math.min(sh - 1, y0 + 1);
      const fx = sx - x0;
      const fy = sy - y0;
      const a = (y0 * sw + x0) * 4;
      const b = (y0 * sw + x1) * 4;
      const c = (y1 * sw + x0) * 4;
      const d = (y1 * sw + x1) * 4;
      const o = (y * width + x) * 4;
      for (let k = 0; k < 4; k++) {
        const top = data[a + k]! + (data[b + k]! - data[a + k]!) * fx;
        const bottom = data[c + k]! + (data[d + k]! - data[c + k]!) * fx;
        out[o + k] = top + (bottom - top) * fy;
      }
    }
  }
  return { width, height, data: out };
}
