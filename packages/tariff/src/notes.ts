import type { Destination } from '@doccheck/schemas';
import { headingRef } from './hs-code';
import { terms as tokenize } from './search';

export type NoteKind = 'legal' | 'subheading' | 'additional' | 'statistical' | 'supplementary';

interface RawNote {
  kind: NoteKind;
  number: string;
  text: string;
}

/** data/tariff/<us|ca>/notes.json, written by scripts/fetch-tariff.mjs. */
export interface NotesFile {
  schedule: Destination;
  retrievedAt: string;
  sections: Record<string, { title: string; url: string; notes: RawNote[] }>;
  chapters: Record<string, { title: string; section: string | null; url: string; notes: RawNote[] }>;
}

/** One numbered note, citable on its own: "Chapter 95, Note 1". */
export interface TariffNote {
  /** "Section XVI, Note 1", "Chapter 95, Subheading Note 1", "Chapter 95, Additional U.S. Note 1". */
  ref: string;
  scope: 'section' | 'chapter';
  chapter?: string;
  section?: string;
  kind: NoteKind;
  text: string;
  url: string;
}

const KIND_LABEL: Record<NoteKind, string> = {
  legal: 'Note',
  subheading: 'Subheading Note',
  additional: 'Additional U.S. Note',
  statistical: 'Statistical Note',
  supplementary: 'Supplementary Note',
};

/**
 * Section and chapter notes of a schedule. They are part of the legal text (General Interpretative
 * Rule 1: classification is determined by the headings and these notes), so a suggestion or a
 * mismatch cites them instead of the model's own reasoning.
 */
export class TariffNotes {
  readonly notes: TariffNote[];

  constructor(readonly file: NotesFile) {
    const notes: TariffNote[] = [];
    for (const [section, s] of Object.entries(file.sections)) {
      for (const n of s.notes) notes.push({ ref: `Section ${section}, ${KIND_LABEL[n.kind]}${n.number ? ` ${n.number}` : ''}`, scope: 'section', section, kind: n.kind, text: n.text, url: s.url });
    }
    for (const [chapter, c] of Object.entries(file.chapters)) {
      for (const n of c.notes) notes.push({ ref: `Chapter ${Number(chapter)}, ${KIND_LABEL[n.kind]}${n.number ? ` ${n.number}` : ''}`, scope: 'chapter', chapter, section: c.section ?? undefined, kind: n.kind, text: n.text, url: c.url });
    }
    this.notes = notes;
  }

  chapterTitle(chapter: string): string | undefined {
    return this.file.chapters[chapter]?.title;
  }

  /** Legal notes that govern a chapter: its section's notes, then its own. Statistical notes are left out. */
  governing(chapter: string): TariffNote[] {
    const section = this.file.chapters[chapter]?.section;
    return this.notes.filter((n) => n.kind !== 'statistical' && ((n.scope === 'chapter' && n.chapter === chapter) || (n.scope === 'section' && n.section === section)));
  }

  /**
   * Notes of `chapter` (and its section) that send goods to heading `toHeading`, the strongest
   * evidence that a declared heading is wrong: Chapter 95 Note 1(o) "Children's bicycles (heading 87.12)".
   */
  pointingTo(chapter: string, toHeading: string): TariffNote[] {
    const re = headingPattern(toHeading);
    return this.governing(chapter).filter((n) => re.test(n.text));
  }

  /** The governing notes of these chapters that share most words with `text`, best first. */
  relevant(text: string, chapters: string[], limit = 3): TariffNote[] {
    const terms = new Set(tokenize(text));
    const seen = new Set<string>();
    return chapters
      .flatMap((c) => this.governing(c))
      .filter((n) => !seen.has(n.ref) && seen.add(n.ref))
      .map((n) => ({ n, score: tokenize(n.text).filter((t) => terms.has(t)).length }))
      // One shared word ("goods", "other") is chance; two or more is a note about these goods.
      .filter((x) => x.score >= 2)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((x) => x.n);
  }
}

/** "heading 87.12" (CBSA), "heading 8712" (USITC), also inside "headings 87.11 to 87.13" lists. */
const headingPattern = (d4: string) => new RegExp(`\\b(${headingRef(d4).replace('.', '\\.')}|${d4})\\b`);

/**
 * A short quote of a note: its opening sentence, then the lettered item that matches best (the
 * heading it points to, or the most shared words), within `max` characters.
 */
export function quoteNote(note: TariffNote, focus: { heading?: string; text?: string }, max = 400): string {
  const [lead, ...items] = note.text.split('\n');
  let pick: string | undefined;
  if (focus.heading) pick = items.find((i) => headingPattern(focus.heading!).test(i));
  if (!pick && focus.text && items.length > 0) {
    const terms = new Set(tokenize(focus.text));
    const best = items.map((i) => ({ i, s: tokenize(i).filter((t) => terms.has(t)).length })).reduce((a, b) => (b.s > a.s ? b : a));
    if (best.s > 0) pick = best.i;
  }
  const out = pick ? `${lead} … ${pick}` : note.text.replace(/\n/g, ' ');
  return out.length > max ? `${out.slice(0, max - 1).trimEnd()}…` : out;
}
