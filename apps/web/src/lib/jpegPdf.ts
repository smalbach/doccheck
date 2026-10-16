export interface JpegPage {
  /** A baseline or progressive JPEG file, embedded as is. */
  jpeg: Uint8Array;
  /** Pixel size of the JPEG. */
  width: number;
  height: number;
  /** 3 for colour (the default), 1 for grayscale. */
  components?: 1 | 3;
}

/** The shorter side of each page, in points: A4 width, so a portrait photo of a page prints near A4. */
const SHORT_SIDE_PT = 595.28;

const latin1 = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0));

const pt = (n: number) => Number(n.toFixed(2)).toString();

/**
 * A PDF with one page per JPEG, the image filling the page (page proportions follow the image).
 * JPEGs go in unchanged as /DCTDecode streams, so nothing is re-encoded. Objects: 1 catalog,
 * 2 page tree, then page, content stream and image for each page.
 */
export function buildJpegPdf(pages: readonly JpegPage[]): Uint8Array<ArrayBuffer> {
  if (pages.length === 0) throw new Error('A PDF needs at least one page');
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const write = (part: string | Uint8Array) => {
    const bytes = typeof part === 'string' ? latin1(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (id: number, body: string, stream?: Uint8Array) => {
    offsets[id] = length;
    write(`${id} 0 obj\n${body}\n`);
    if (stream) {
      write('stream\n');
      write(stream);
      write('\nendstream\n');
    }
    write('endobj\n');
  };

  // The binary comment line tells transfer tools the file is not text.
  write('%PDF-1.4\n%âãÏÓ\n');
  const pageIds = pages.map((_, i) => 3 + i * 3);
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  pages.forEach((page, i) => {
    const id = pageIds[i]!;
    const scale = SHORT_SIDE_PT / Math.min(page.width, page.height);
    const w = pt(page.width * scale);
    const h = pt(page.height * scale);
    const content = latin1(`q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`);
    object(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`);
    object(id + 1, `<< /Length ${content.length} >>`, content);
    const colour = page.components === 1 ? '/DeviceGray' : '/DeviceRGB';
    object(
      id + 2,
      `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace ${colour} /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>`,
      page.jpeg,
    );
  });

  const size = 3 + pages.length * 3;
  const xref = length;
  // Each entry is exactly 20 bytes, line end included.
  write(`xref\n0 ${size}\n0000000000 65535 f \n`);
  for (let id = 1; id < size; id++) write(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  write(`trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/** "scan-20261016-0930.pdf", in local time. */
export function scanFileName(date: Date): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `scan-${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}-${two(date.getHours())}${two(date.getMinutes())}.pdf`;
}
