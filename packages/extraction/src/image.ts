/**
 * Photos of documents (JPEG, PNG, or HEIC from a phone) made into a one-page, image-only PDF, so they
 * go through the scan path: OCR, citations with boxes, and the viewer, which draws the boxes on the
 * photo. On the way the photo is turned upright (EXIF orientation), deskewed (the angle at which the
 * rows of text line up best) and cropped to the sheet of paper (the bright region around the text).
 * Everything runs locally with @napi-rs/canvas; HEIC is decoded with libheif (heic-decode).
 */

export type ImageFormat = 'jpeg' | 'png' | 'heic';

export function imageFormat(fileName: string, bytes: Uint8Array): ImageFormat | undefined {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  const brand = new TextDecoder().decode(bytes.subarray(4, 12));
  if (/^ftyp(heic|heix|hevc|hevx|mif1|msf1|heim|heis)$/.test(brand)) return 'heic';
  return /\.(heic|heif)$/i.test(fileName) ? 'heic' : undefined;
}

export interface Rgba {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** EXIF orientation of a JPEG (1 = upright; 3, 6, 8 = rotated 180, 90 cw, 90 ccw; 2, 4, 5, 7 mirrored). */
export function jpegOrientation(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 4 < bytes.length && bytes[offset] === 0xff) {
    const marker = bytes[offset + 1];
    const length = view.getUint16(offset + 2);
    if (marker === 0xe1 && new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8)) === 'Exif') {
      const tiff = offset + 10;
      const little = view.getUint16(tiff) === 0x4949;
      const u16 = (o: number) => view.getUint16(o, little);
      const ifd = tiff + view.getUint32(tiff + 4, little);
      for (let i = 0; i < u16(ifd); i++) {
        const entry = ifd + 2 + i * 12;
        if (u16(entry) === 0x0112) return u16(entry + 8);
      }
      return 1;
    }
    if (marker === 0xda) break;
    offset += 2 + length;
  }
  return 1;
}

async function canvasModule() {
  return import('@napi-rs/canvas');
}

/** Decoded pixels, upright. */
export async function decodeImage(bytes: Uint8Array, format: ImageFormat): Promise<Rgba> {
  const { createCanvas, loadImage } = await canvasModule();
  if (format === 'heic') {
    const decode = (await import('heic-decode')).default ?? (await import('heic-decode'));
    const img = await (decode as unknown as (i: { buffer: Uint8Array }) => Promise<Rgba>)({ buffer: bytes });
    return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
  }
  const img = await loadImage(Buffer.from(bytes));
  const orientation = format === 'jpeg' ? jpegOrientation(bytes) : 1;
  const swap = orientation >= 5;
  const width = swap ? img.height : img.width;
  const height = swap ? img.width : img.height;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  // The transforms of EXIF orientations 2-8, applied before drawing.
  const t: Record<number, [number, number, number, number, number, number]> = {
    2: [-1, 0, 0, 1, img.width, 0],
    3: [-1, 0, 0, -1, img.width, img.height],
    4: [1, 0, 0, -1, 0, img.height],
    5: [0, 1, 1, 0, 0, 0],
    6: [0, 1, -1, 0, img.height, 0],
    7: [0, -1, -1, 0, img.height, img.width],
    8: [0, -1, 1, 0, 0, img.width],
  };
  if (t[orientation]) ctx.setTransform(...t[orientation]);
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, width, height).data;
  return { width, height, data: new Uint8ClampedArray(data) };
}

/** Grayscale (0-255) at most `max` pixels on the long side, with the factor it was scaled by. */
function grayscale(img: Rgba, max = 900): { gray: Uint8Array; w: number; h: number; scale: number } {
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const gray = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (Math.min(img.height - 1, Math.floor(y / scale)) * img.width + Math.min(img.width - 1, Math.floor(x / scale))) * 4;
      gray[y * w + x] = (img.data[i] * 299 + img.data[i + 1] * 587 + img.data[i + 2] * 114) / 1000;
    }
  }
  return { gray, w, h, scale };
}

/** Otsu's threshold: the gray level that best separates dark (ink, table) from bright (paper). */
export function otsu(gray: Uint8Array): number {
  const hist = new Array<number>(256).fill(0);
  for (const g of gray) hist[g]++;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const between = wB * wF * (sumB / wB - (sum - sumB) / wF) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

/**
 * The bounding box of the sheet of paper, in the grayscale image: rows and columns where most pixels
 * are paper-bright. Returns the whole image when the paper already fills it.
 */
function paperBounds(gray: Uint8Array, w: number, h: number): [number, number, number, number] {
  const t = otsu(gray);
  const rowBright = new Array<number>(h).fill(0);
  const colBright = new Array<number>(w).fill(0);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (gray[y * w + x] > t) (rowBright[y]++, colBright[x]++);
  const span = (counts: number[], n: number) => {
    const ok = counts.map((c) => c / n > 0.45);
    const first = ok.indexOf(true);
    const last = ok.lastIndexOf(true);
    return first < 0 ? [0, counts.length - 1] : [first, last];
  };
  const [y0, y1] = span(rowBright, w);
  const [x0, x1] = span(colBright, h);
  return [x0, y0, x1 + 1, y1 + 1];
}

/**
 * The skew of the text in degrees (positive: the text runs down to the right): the angle, within
 * ±maxDeg, at which the dark pixels projected onto the vertical axis give the sharpest profile
 * (rows of text and gaps between them). A coarse search, then a fine one around the best angle.
 */
export function skewAngle(gray: Uint8Array, w: number, h: number, maxDeg = 12): number {
  const t = otsu(gray);
  const xs: number[] = [];
  const ys: number[] = [];
  // Ink only: look inside the paper, well clear of its edges and of the dark table around it.
  const [px0, py0, px1, py1] = paperBounds(gray, w, h);
  const ix = Math.round((px1 - px0) * 0.1);
  const iy = Math.round((py1 - py0) * 0.1);
  for (let y = py0 + iy; y < py1 - iy; y++) for (let x = px0 + ix; x < px1 - ix; x++) if (gray[y * w + x] < t * 0.8) (xs.push(x), ys.push(y));
  if (xs.length < 50) return 0;
  const score = (deg: number) => {
    const a = (deg * Math.PI) / 180;
    const sin = Math.sin(a);
    const cos = Math.cos(a);
    const bins = new Float64Array(h * 2 + w);
    for (let i = 0; i < xs.length; i++) bins[Math.round(ys[i] * cos - xs[i] * sin) + w] += 1;
    let s = 0;
    for (let i = 1; i < bins.length; i++) s += (bins[i] - bins[i - 1]) ** 2;
    return s;
  };
  let best = 0;
  let bestScore = -1;
  for (let d = -maxDeg; d <= maxDeg; d += 0.5) {
    const s = score(d);
    if (s > bestScore) [best, bestScore] = [d, s];
  }
  for (let d = best - 0.5; d <= best + 0.5; d += 0.1) {
    const s = score(d);
    if (s > bestScore) [best, bestScore] = [d, s];
  }
  return Math.round(best * 10) / 10;
}

export interface PreparedImage {
  /** One-page PDF holding the cleaned-up photo as a JPEG. */
  pdf: Buffer;
  width: number;
  height: number;
  /** Degrees the photo was rotated by to straighten the text. */
  rotated: number;
  /** The part of the upright photo kept, in its pixels. */
  crop: [number, number, number, number];
}

/** Width of the PDF page in points: A4 portrait, or A4 landscape for a wide photo. The height follows the photo. */
const PAGE_WIDTH_PT = { portrait: 595.28, landscape: 841.89 };
/** Long side of the image kept in the PDF: enough for OCR (rendered at 4x), small enough to store. */
const MAX_SIDE = 2600;

export async function prepareImage(bytes: Uint8Array, fileName: string): Promise<PreparedImage> {
  const format = imageFormat(fileName, bytes);
  if (!format) throw new Error(`${fileName} is not a JPEG, PNG or HEIC image`);
  const img = await decodeImage(bytes, format);
  const { createCanvas } = await canvasModule();
  const small = grayscale(img);
  const angle = skewAngle(small.gray, small.w, small.h);

  // Straighten the whole photo on a canvas big enough to hold it rotated.
  const a = (-angle * Math.PI) / 180;
  const rw = Math.ceil(Math.abs(img.width * Math.cos(a)) + Math.abs(img.height * Math.sin(a)));
  const rh = Math.ceil(Math.abs(img.width * Math.sin(a)) + Math.abs(img.height * Math.cos(a)));
  const source = createCanvas(img.width, img.height);
  const sctx = source.getContext('2d');
  const imageData = sctx.createImageData(img.width, img.height);
  imageData.data.set(img.data);
  sctx.putImageData(imageData, 0, 0);
  const straight = createCanvas(rw, rh);
  const ctx = straight.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, rw, rh);
  ctx.translate(rw / 2, rh / 2);
  ctx.rotate(a);
  ctx.drawImage(source, -img.width / 2, -img.height / 2);

  const upright: Rgba = { width: rw, height: rh, data: new Uint8ClampedArray(ctx.getImageData(0, 0, rw, rh).data) };
  const g = grayscale(upright);
  const [bx0, by0, bx1, by1] = paperBounds(g.gray, g.w, g.h);
  const crop: [number, number, number, number] = [Math.floor(bx0 / g.scale), Math.floor(by0 / g.scale), Math.min(rw, Math.ceil(bx1 / g.scale)), Math.min(rh, Math.ceil(by1 / g.scale))];
  const cw = Math.max(1, crop[2] - crop[0]);
  const ch = Math.max(1, crop[3] - crop[1]);
  const fit = Math.min(1, MAX_SIDE / Math.max(cw, ch));
  const outW = Math.round(cw * fit);
  const outH = Math.round(ch * fit);
  const out = createCanvas(outW, outH);
  out.getContext('2d').drawImage(straight, crop[0], crop[1], cw, ch, 0, 0, outW, outH);
  const jpeg = await out.encode('jpeg', 88);
  return { pdf: jpegToPdf(jpeg, outW, outH, outW > outH ? PAGE_WIDTH_PT.landscape : PAGE_WIDTH_PT.portrait), width: outW, height: outH, rotated: angle, crop };
}

/** A one-page PDF showing a JPEG of width x height pixels on a page `pageWidth` points wide. */
export function jpegToPdf(jpeg: Buffer, width: number, height: number, pageWidth = PAGE_WIDTH_PT.portrait): Buffer {
  const pw = Math.round(pageWidth * 100) / 100;
  const ph = Math.round(((pageWidth * height) / width) * 100) / 100;
  const content = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`;
  const objects: (string | Buffer)[][] = [
    ['<< /Type /Catalog /Pages 2 0 R >>'],
    ['<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`],
    [`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, jpeg, '\nendstream'],
    [`<< /Length ${content.length} >>\nstream\n${content}\nendstream`],
  ];
  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'binary')];
  const offsets: number[] = [];
  let length = parts[0].length;
  objects.forEach((body, i) => {
    offsets.push(length);
    const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), ...body.map((b) => (typeof b === 'string' ? Buffer.from(b, 'binary') : b)), Buffer.from('\nendobj\n')]);
    parts.push(chunk);
    length += chunk.length;
  });
  const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`;
  parts.push(Buffer.from(xref));
  return Buffer.concat(parts);
}
