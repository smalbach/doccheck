import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { imageFormat, jpegOrientation, prepareImage, skewAngle } from './image';
import { readPdfText } from './pdf-text';

/** A "photo" of a page: black text rows on white paper, rotated, on a dark table. */
async function photo(deg: number): Promise<Buffer> {
  const page = createCanvas(600, 800);
  const p = page.getContext('2d');
  p.fillStyle = '#fff';
  p.fillRect(0, 0, 600, 800);
  p.fillStyle = '#111';
  p.font = '22px sans-serif';
  for (let i = 0; i < 24; i++) p.fillText(`COMMERCIAL INVOICE LINE ${i + 1}   QTY 6000   USD 48,600.00`, 30, 50 + i * 30);
  const shot = createCanvas(1000, 1100);
  const s = shot.getContext('2d');
  s.fillStyle = '#3a3026';
  s.fillRect(0, 0, 1000, 1100);
  s.translate(500, 550);
  s.rotate((deg * Math.PI) / 180);
  s.drawImage(page, -300, -400);
  return shot.encode('jpeg', 92);
}

const grayOf = async (jpeg: Buffer) => {
  const { loadImage } = await import('@napi-rs/canvas');
  const img = await loadImage(jpeg);
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, img.width, img.height).data;
  const gray = new Uint8Array(img.width * img.height);
  for (let i = 0; i < gray.length; i++) gray[i] = (d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]) / 3;
  return { gray, w: img.width, h: img.height };
};

describe('photos of documents', () => {
  it('recognizes the formats by their bytes', () => {
    expect(imageFormat('a.bin', new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
    expect(imageFormat('a.bin', new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe('png');
    expect(imageFormat('IMG_0042.HEIC', new Uint8Array([0, 0, 0, 24, ...new TextEncoder().encode('ftypheic')]))).toBe('heic');
    expect(imageFormat('a.pdf', new TextEncoder().encode('%PDF-1.7'))).toBeUndefined();
  });

  it('measures the skew of the text', async () => {
    for (const deg of [-6, 0, 4]) {
      const { gray, w, h } = await grayOf(await photo(deg));
      expect(Math.abs(skewAngle(gray, w, h) - deg)).toBeLessThanOrEqual(0.6);
    }
  });

  it('straightens and crops the photo into a one-page image PDF that goes to OCR', async () => {
    const out = await prepareImage(await photo(5), 'invoice.jpg');
    expect(Math.abs(out.rotated - 5)).toBeLessThanOrEqual(0.6);
    // Cropped to the paper: close to its 600 x 800 pixels (the rotated sheet's corners add a little).
    expect(out.width).toBeLessThan(760);
    expect(out.height).toBeLessThan(940);
    expect(out.width).toBeGreaterThan(560);
    const text = await readPdfText(out.pdf, { ocr: 'off' });
    expect(text.pageCount).toBe(1);
    expect(text.lines).toEqual([]);
  });

  it('reads the EXIF orientation of a JPEG', async () => {
    const jpeg = await photo(0);
    expect(jpegOrientation(jpeg)).toBe(1);
    // An APP1 Exif segment with orientation 6 (rotate 90 clockwise), big-endian.
    const exif = Buffer.from([0xff, 0xe1, 0x00, 0x22, ...Buffer.from('Exif\0\0'), 0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, 0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    expect(jpegOrientation(Buffer.concat([jpeg.subarray(0, 2), exif, jpeg.subarray(2)]))).toBe(6);
  });
});
