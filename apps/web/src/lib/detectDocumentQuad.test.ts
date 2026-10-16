import { describe, expect, it } from 'vitest';
import { detectDocumentQuad } from './detectDocumentQuad';
import type { Point, Quad, RasterImage } from './rasterImage';

/** A background with a filled convex quad painted on it, plus dark "text" lines inside the page. */
function photo(width: number, height: number, page: Quad | undefined, { pageGray = 230, background = 60, text = true } = {}): RasterImage {
  const data = new Uint8ClampedArray(width * height * 4);
  const inside = (x: number, y: number) =>
    !!page &&
    page.every((a, i) => {
      const b = page[(i + 1) % 4]!;
      return (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x) >= 0;
    });
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let v = inside(x, y) ? pageGray : background;
      if (text && inside(x, y) && y % 9 < 2 && x % 13 < 9) v = 40;
      // A little deterministic noise.
      v += ((x * 7 + y * 13) % 11) - 5;
      data.set([v, v, v, 255], (y * width + x) * 4);
    }
  return { width, height, data };
}

const q = (...xy: number[]): Quad => [
  { x: xy[0]!, y: xy[1]! },
  { x: xy[2]!, y: xy[3]! },
  { x: xy[4]!, y: xy[5]! },
  { x: xy[6]!, y: xy[7]! },
];

function expectNear(actual: Quad, expected: Quad, tolerance: number) {
  actual.forEach((p: Point, i) => {
    expect(Math.abs(p.x - expected[i]!.x)).toBeLessThanOrEqual(tolerance);
    expect(Math.abs(p.y - expected[i]!.y)).toBeLessThanOrEqual(tolerance);
  });
}

describe('detectDocumentQuad', () => {
  it('finds a light page on a dark surface', () => {
    const page = q(60, 30, 250, 40, 240, 220, 50, 210);
    const result = detectDocumentQuad(photo(320, 240, page));
    expect(result.found).toBe(true);
    expectNear(result.quad, page, 6);
  });

  it('finds a dark page on a light surface', () => {
    const page = q(80, 40, 230, 50, 220, 200, 70, 190);
    const result = detectDocumentQuad(photo(320, 240, page, { pageGray: 50, background: 220, text: false }));
    expect(result.found).toBe(true);
    expectNear(result.quad, page, 6);
  });

  it('falls back to the full frame on a flat image', () => {
    const result = detectDocumentQuad(photo(200, 150, undefined));
    expect(result.found).toBe(false);
    expect(result.quad).toEqual(q(0, 0, 199, 0, 199, 149, 0, 149));
  });

  it('falls back when the bright region is too small to be a page', () => {
    expect(detectDocumentQuad(photo(320, 240, q(10, 10, 40, 10, 40, 40, 10, 40))).found).toBe(false);
  });

  it('falls back when the bright region is not quad-shaped', () => {
    // A plus sign: its extreme points span the horizontal bar, leaving the vertical bar outside.
    const width = 320;
    const height = 240;
    const img = photo(width, height, undefined);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const v = (x >= 20 && x < 300 && y >= 100 && y < 140) || (x >= 140 && x < 180 && y >= 20 && y < 220) ? 230 : 60;
        img.data.set([v, v, v, 255], (y * width + x) * 4);
      }
    expect(detectDocumentQuad(img).found).toBe(false);
  });

  it('falls back on a tiny image', () => {
    expect(detectDocumentQuad(photo(4, 4, undefined)).found).toBe(false);
  });
});
