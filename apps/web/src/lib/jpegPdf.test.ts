import { describe, expect, it } from 'vitest';
import { buildJpegPdf, scanFileName } from './jpegPdf';

const text = (bytes: Uint8Array) => Array.from(bytes, (b) => String.fromCharCode(b)).join('');

/** Not a real JPEG: the writer embeds the bytes as they are. */
const fakeJpeg = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 37) % 256);

describe('buildJpegPdf', () => {
  const pdf = buildJpegPdf([
    { jpeg: fakeJpeg(300), width: 1000, height: 1414 },
    { jpeg: fakeJpeg(120), width: 1600, height: 900, components: 1 },
  ]);
  const body = text(pdf);

  it('starts and ends like a PDF', () => {
    expect(body.startsWith('%PDF-1.4\n')).toBe(true);
    expect(body.endsWith('%%EOF\n')).toBe(true);
  });

  it('has an xref whose offsets point at each object', () => {
    const startxref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(body)![1]);
    expect(body.slice(startxref, startxref + 4)).toBe('xref');
    const [, first, count] = /^xref\n(\d+) (\d+)\n/.exec(body.slice(startxref))!;
    expect(Number(first)).toBe(0);
    expect(Number(count)).toBe(9);
    const entries = body.slice(startxref).split('\n').slice(2, 2 + 9);
    expect(entries[0]).toBe('0000000000 65535 f ');
    for (let id = 1; id < 9; id++) {
      const offset = Number(entries[id]!.slice(0, 10));
      expect(body.slice(offset, offset + `${id} 0 obj`.length)).toBe(`${id} 0 obj`);
    }
    expect(body).toContain('trailer\n<< /Size 9 /Root 1 0 R >>');
  });

  it('lists every page and sizes it from the image', () => {
    expect(body).toContain('/Kids [3 0 R 6 0 R] /Count 2');
    expect(body).toContain('/MediaBox [0 0 595.28 841.73]');
    expect(body).toContain('/MediaBox [0 0 1058.28 595.28]');
  });

  it('embeds each JPEG unchanged as /DCTDecode with its length', () => {
    expect(body).toContain('/Width 1000 /Height 1414 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length 300');
    expect(body).toContain('/ColorSpace /DeviceGray');
    const start = body.indexOf('stream\n', body.indexOf('/Length 300')) + 'stream\n'.length;
    expect(Array.from(pdf.subarray(start, start + 300))).toEqual(Array.from(fakeJpeg(300)));
    expect(body.slice(start + 300, start + 300 + 11)).toBe('\nendstream\n');
  });

  it('gives each content stream its real length', () => {
    const match = /<< \/Length (\d+) >>\nstream\n(q [^\n]*)\nendstream/.exec(body)!;
    expect(match[2]!.length).toBe(Number(match[1]));
    expect(match[2]).toBe('q 595.28 0 0 841.73 0 0 cm /Im0 Do Q');
  });

  it('refuses an empty list', () => {
    expect(() => buildJpegPdf([])).toThrow();
  });
});

describe('scanFileName', () => {
  it('names the file after the local date and time', () => {
    expect(scanFileName(new Date(2026, 9, 6, 9, 5))).toBe('scan-20261006-0905.pdf');
  });
});
