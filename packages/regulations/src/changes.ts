import { createHash } from 'node:crypto';
import type { CorpusDocument } from './corpus';

/** One paragraph of a regulation document, the unit a change is reported in. */
export interface Passage {
  documentId: string;
  /** Heading path inside the document: "§ 149.3 Data elements > ...". */
  section: string;
  /** Position among the document's passages, from 0. */
  ordinal: number;
  text: string;
  /** SHA-256 of the text with whitespace collapsed: formatting alone is not a change. */
  hash: string;
}

export type PassageChange =
  | { kind: 'added'; after: Passage }
  | { kind: 'removed'; before: Passage }
  | { kind: 'changed'; before: Passage; after: Passage };

const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
export const passageHash = (text: string) => createHash('sha256').update(normalize(text)).digest('hex');

/** The document's paragraphs (not its headings), each with the heading path above it. */
export function passagesOf(doc: Pick<CorpusDocument, 'id' | 'body'>): Passage[] {
  const out: Passage[] = [];
  const headings: string[] = [];
  for (const block of doc.body.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean)) {
    const h = block.match(/^(#{1,3}) (.+)$/);
    if (h) {
      headings.length = h[1].length - 1;
      headings[h[1].length - 1] = h[2];
      continue;
    }
    out.push({ documentId: doc.id, section: headings.filter(Boolean).join(' > '), ordinal: out.length, text: block, hash: passageHash(block) });
  }
  return out;
}

/**
 * What changed between two versions of a document's passages, deterministic and in document order.
 * Passages are matched by hash and heading path along the longest common subsequence, so an inserted paragraph does
 * not make every later one look changed. Between two matched passages, unmatched old and new ones
 * in the same section are paired in order as "changed"; the rest are "removed" or "added".
 */
export function diffPassages(before: readonly Passage[], after: readonly Passage[]): PassageChange[] {
  const same = (a: Passage, b: Passage) => a.hash === b.hash && a.section === b.section;
  const n = before.length;
  const m = after.length;
  // lcs[i][j]: length of the longest common subsequence of before[i..] and after[j..].
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = same(before[i], after[j]) ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const changes: PassageChange[] = [];
  let removed: Passage[] = [];
  let added: Passage[] = [];
  const flush = () => {
    for (const b of removed) {
      const k = added.findIndex((a) => a.section === b.section);
      if (k >= 0) {
        const [a] = added.splice(k, 1);
        changes.push({ kind: 'changed', before: b, after: a });
      } else changes.push({ kind: 'removed', before: b });
    }
    for (const a of added) changes.push({ kind: 'added', after: a });
    removed = [];
    added = [];
  };
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && same(before[i], after[j])) {
      flush();
      i++;
      j++;
    } else if (j < m && (i === n || lcs[i][j + 1] >= lcs[i + 1][j])) added.push(after[j++]);
    else removed.push(before[i++]);
  }
  flush();
  return changes;
}
