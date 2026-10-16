import { cropSize, warpPerspective } from '../../lib/perspectiveWarp';
import { detectDocumentQuad } from '../../lib/detectDocumentQuad';
import { buildJpegPdf, scanFileName } from '../../lib/jpegPdf';
import { scaleQuad, type Quad } from '../../lib/rasterImage';

/** One JPEG image of a page, with an object URL for previews (release() frees it). */
export interface ScanImage {
  id: number;
  blob: Blob;
  url: string;
  width: number;
  height: number;
}

/** A captured frame waiting for the user: the photo, the page's corners in it, and the straightened crop. */
export interface Candidate {
  photo: ScanImage;
  crop?: ScanImage;
  quad: Quad;
}

/** Longest side kept for pages (enough for OCR, small enough for a 20-page PDF under the upload limit). */
const MAX_SIDE = 2000;
/** Edges are looked for in a small copy: fast, and the blur ignores text better. */
const DETECT_SIDE = 360;
const JPEG_QUALITY = 0.85;

let nextId = 1;

function canvasFrom(source: CanvasImageSource, width: number, height: number, maxSide: number): HTMLCanvasElement {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function toImage(canvas: HTMLCanvasElement): Promise<ScanImage> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve({ id: nextId++, blob, url: URL.createObjectURL(blob), width: canvas.width, height: canvas.height }) : reject(new Error('JPEG encoding failed'))),
      'image/jpeg',
      JPEG_QUALITY,
    ),
  );
}

export const release = (image: ScanImage | undefined) => image && URL.revokeObjectURL(image.url);

/** Detects the page in a video frame or photo and straightens it; no crop when no page was found. */
export async function makeCandidate(source: CanvasImageSource, width: number, height: number): Promise<Candidate> {
  const full = canvasFrom(source, width, height, MAX_SIDE);
  const small = canvasFrom(full, full.width, full.height, DETECT_SIDE);
  const detected = detectDocumentQuad(small.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, small.width, small.height));
  const quad = scaleQuad(detected.quad, full.width / small.width);
  const photo = await toImage(full);
  if (!detected.found) return { photo, quad };
  const size = cropSize(quad, MAX_SIDE);
  const warped = warpPerspective(full.getContext('2d')!.getImageData(0, 0, full.width, full.height), quad, size.width, size.height);
  const out = document.createElement('canvas');
  out.width = warped.width;
  out.height = warped.height;
  out.getContext('2d')!.putImageData(new ImageData(warped.data, warped.width, warped.height), 0, 0);
  return { photo, quad, crop: await toImage(out) };
}

export async function candidateFromFile(file: File): Promise<Candidate> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    return await makeCandidate(bitmap, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}

/** The pages, in order, as one PDF file named after the current time. */
export async function pagesToPdf(pages: readonly ScanImage[]): Promise<File> {
  const jpegs = await Promise.all(pages.map(async (p) => ({ jpeg: new Uint8Array(await p.blob.arrayBuffer()), width: p.width, height: p.height })));
  return new File([buildJpegPdf(jpegs)], scanFileName(new Date()), { type: 'application/pdf' });
}

/** Lets React paint a status message before a long synchronous step. */
export const nextPaint = () => new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
