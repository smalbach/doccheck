const PADDING = 3;

/** Outlines a region of the page; `bbox` is in PDF points, `scale` converts to CSS pixels. */
export function HighlightMark({ bbox, scale }: { bbox: [number, number, number, number]; scale: number }) {
  const [x0, y0, x1, y1] = bbox;
  return (
    <div
      className="highlight"
      style={{ left: x0 * scale - PADDING, top: y0 * scale - PADDING, width: (x1 - x0) * scale + 2 * PADDING, height: (y1 - y0) * scale + 2 * PADDING }}
    />
  );
}
