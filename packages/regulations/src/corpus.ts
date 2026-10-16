import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Who issues (or, for the EU, which law governs) a corpus document: matches the destination profiles. */
export type Authority = 'CBSA' | 'CBP' | 'ANAM' | 'UCC' | 'HMRC';

/** One regulation document from data/corpus/<authority>/<id>.md. */
export interface CorpusDocument {
  id: string;
  title: string;
  authority: Authority;
  language: string;
  url: string;
  effectiveDate?: string;
  retrievedAt?: string;
  body: string;
}

/** A searchable piece of a document, small enough to quote as a citation. */
export interface Chunk {
  id: string;
  documentId: string;
  authority: Authority;
  language: string;
  title: string;
  url: string;
  effectiveDate?: string;
  /** Heading path inside the document: "Appendix A > Instructions on How to Complete...". */
  section: string;
  text: string;
}

export function parseDocument(raw: string): CorpusDocument {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) throw new Error('Corpus document without front matter');
  const meta: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) meta[line.slice(0, i).trim()] = JSON.parse(line.slice(i + 1).trim());
  }
  return {
    id: meta.id,
    title: meta.title,
    authority: meta.authority as Authority,
    language: meta.language,
    url: meta.url,
    effectiveDate: meta.effectiveDate,
    retrievedAt: meta.retrievedAt,
    body: raw.slice(m[0].length),
  };
}

export async function loadCorpus(dir: string): Promise<CorpusDocument[]> {
  const docs: CorpusDocument[] = [];
  for (const sub of (await readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory())) {
    for (const f of (await readdir(join(dir, sub.name))).filter((f) => f.endsWith('.md')).sort()) {
      docs.push(parseDocument(await readFile(join(dir, sub.name, f), 'utf8')));
    }
  }
  return docs;
}

/**
 * Splits by headings, then packs paragraphs up to `maxChars`. A paragraph is never cut, so a
 * citation always quotes whole sentences; every chunk carries its heading path for context.
 */
export function chunkDocument(doc: CorpusDocument, maxChars = 1200): Chunk[] {
  const chunks: Chunk[] = [];
  const headings: string[] = [];
  let buffer: string[] = [];
  const flush = () => {
    if (buffer.length === 0) return;
    chunks.push({
      id: `${doc.id}#${chunks.length + 1}`,
      documentId: doc.id,
      authority: doc.authority,
      language: doc.language,
      title: doc.title,
      url: doc.url,
      effectiveDate: doc.effectiveDate,
      section: headings.filter(Boolean).join(' > '),
      text: buffer.join('\n\n'),
    });
    buffer = [];
  };
  for (const block of doc.body.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean)) {
    const h = block.match(/^(#{1,3}) (.+)$/);
    if (h) {
      flush();
      const level = h[1].length;
      headings.length = level - 1;
      headings[level - 1] = h[2];
      continue;
    }
    if (buffer.length > 0 && buffer.join('\n\n').length + block.length > maxChars) flush();
    buffer.push(block);
  }
  flush();
  return chunks;
}
