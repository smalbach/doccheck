/** RGBA pixels, row by row: the shape of the DOM's ImageData, usable without a canvas (tests). */
export interface RasterImage {
  width: number;
  height: number;
  data: Uint8ClampedArray<ArrayBuffer>;
}

export interface Point {
  x: number;
  y: number;
}

/** Corners clockwise from the top-left: top-left, top-right, bottom-right, bottom-left. */
export type Quad = readonly [Point, Point, Point, Point];

export const fullFrame = (width: number, height: number): Quad => [
  { x: 0, y: 0 },
  { x: width - 1, y: 0 },
  { x: width - 1, y: height - 1 },
  { x: 0, y: height - 1 },
];

export const scaleQuad = (quad: Quad, factor: number): Quad => quad.map((p) => ({ x: p.x * factor, y: p.y * factor })) as unknown as Quad;

/** Shoelace area of a polygon. */
export function quadArea(quad: Quad): number {
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    const a = quad[i]!;
    const b = quad[(i + 1) % 4]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}
