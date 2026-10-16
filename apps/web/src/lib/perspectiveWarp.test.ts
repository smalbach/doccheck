import { describe, expect, it } from 'vitest';
import { applyHomography, cropSize, solveHomography, warpPerspective } from './perspectiveWarp';
import type { Quad, RasterImage } from './rasterImage';

const quad = (...xy: number[]): Quad => [
  { x: xy[0]!, y: xy[1]! },
  { x: xy[2]!, y: xy[3]! },
  { x: xy[4]!, y: xy[5]! },
  { x: xy[6]!, y: xy[7]! },
];

/** A width x height image whose red channel is x and green channel is y. */
function gradient(width: number, height: number): RasterImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) data.set([x, y, 0, 255], (y * width + x) * 4);
  return { width, height, data };
}

describe('solveHomography', () => {
  it('maps each corner onto its pair', () => {
    const from = quad(0, 0, 100, 0, 100, 150, 0, 150);
    const to = quad(12, 8, 190, 30, 170, 260, 5, 220);
    const h = solveHomography(from, to);
    from.forEach((p, i) => {
      const q = applyHomography(h, p);
      expect(q.x).toBeCloseTo(to[i]!.x, 6);
      expect(q.y).toBeCloseTo(to[i]!.y, 6);
    });
  });

  it('is the identity for identical quads', () => {
    const q = quad(3, 4, 50, 2, 55, 60, 1, 58);
    const h = solveHomography(q, q);
    expect(applyHomography(h, { x: 20, y: 30 }).x).toBeCloseTo(20, 6);
    expect(applyHomography(h, { x: 20, y: 30 }).y).toBeCloseTo(30, 6);
  });

  it('refuses a quad with three corners on one line', () => {
    expect(() => solveHomography(quad(0, 0, 10, 0, 20, 0, 0, 10), quad(0, 0, 10, 0, 10, 10, 0, 10))).toThrow();
  });
});

describe('cropSize', () => {
  it('takes the longer of opposite edges and fits the longest side', () => {
    expect(cropSize(quad(0, 0, 100, 0, 110, 200, -10, 200))).toEqual({ width: 120, height: 200 });
    expect(cropSize(quad(0, 0, 100, 0, 110, 200, -10, 200), 100)).toEqual({ width: 60, height: 100 });
  });
});

describe('warpPerspective', () => {
  it('copies an axis-aligned region exactly', () => {
    const src = gradient(40, 30);
    const out = warpPerspective(src, quad(10, 5, 29, 5, 29, 24, 10, 24), 20, 20);
    expect(out.width).toBe(20);
    expect(Array.from(out.data.subarray(0, 4))).toEqual([10, 5, 0, 255]);
    const last = (20 * 20 - 1) * 4;
    expect(Array.from(out.data.subarray(last, last + 4))).toEqual([29, 24, 0, 255]);
  });

  it('samples between pixels bilinearly', () => {
    const src = gradient(10, 10);
    // Half the size: output pixel 1 lands between source pixels 2 and 3 ... at 2.25.
    const out = warpPerspective(src, quad(0, 0, 9, 0, 9, 9, 0, 9), 5, 5);
    expect(out.data[4]).toBe(2); // 2.25 rounds down in a Uint8ClampedArray
    expect(out.data[(4 * 5 + 4) * 4]).toBe(9);
  });

  it('straightens a tilted page: the corners land on the rectangle corners', () => {
    const src = gradient(100, 100);
    const page = quad(20, 10, 80, 20, 90, 90, 10, 80);
    const out = warpPerspective(src, page, 30, 40);
    const px = (x: number, y: number) => [out.data[(y * 30 + x) * 4], out.data[(y * 30 + x) * 4 + 1]];
    expect(px(0, 0)).toEqual([20, 10]);
    expect(px(29, 0)).toEqual([80, 20]);
    expect(px(29, 39)).toEqual([90, 90]);
    expect(px(0, 39)).toEqual([10, 80]);
  });
});
