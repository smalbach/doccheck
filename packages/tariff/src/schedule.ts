import type { Destination } from '@doccheck/schemas';
import { formatHs, isNationalChapter } from './hs-code';

/** data/tariff/<us|ca>/schedule.json, written by scripts/fetch-tariff.mjs. */
export interface ScheduleFile {
  schedule: Destination;
  title: string;
  edition: string;
  effectiveDate?: string;
  url: string;
  retrievedAt: string;
  /** [code digits ("" for a grouping row without a number), description, index of the parent or -1]. */
  entries: [string, string, number][];
}

export interface TariffEntry {
  code: string;
  description: string;
  parent: number;
}

/** One HS subheading (6 digits) as this schedule describes it. */
export interface Subheading {
  /** "950300" */
  code: string;
  heading: string;
  chapter: string;
  /** Heading and subheading wording, for display: "Tricycles, scooters, ... — Other toys". */
  title: string;
  /** Everything the schedule says under this subheading, for search. */
  text: string;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/**
 * A national tariff schedule: every code with its description and place in the tree. Codes are
 * digits only; both schedules share the first 6 digits (the HS) and add national digits after.
 */
export class TariffSchedule {
  readonly entries: TariffEntry[];
  private readonly byCode = new Map<string, number>();
  private readonly hs6 = new Map<string, number[]>();
  /** Shortest code under each 4-digit heading. */
  private readonly headings = new Map<string, number>();
  private subheadingList?: Subheading[];

  constructor(readonly file: ScheduleFile) {
    this.entries = file.entries.map(([code, description, parent]) => ({ code, description, parent }));
    this.entries.forEach((e, i) => {
      if (!e.code) return;
      if (!this.byCode.has(e.code)) this.byCode.set(e.code, i);
      const h = e.code.slice(0, 4);
      if (e.code.length >= 4 && (!this.headings.has(h) || this.entries[this.headings.get(h)!].code.length > e.code.length)) this.headings.set(h, i);
      if (e.code.length >= 6 && !isNationalChapter(e.code)) {
        const key = e.code.slice(0, 6);
        (this.hs6.get(key) ?? this.hs6.set(key, []).get(key)!).push(i);
      }
    });
  }

  get id(): Destination {
    return this.file.schedule;
  }

  /** Exact code, at any level ("9503", "950300", "95030000", "9503000090"). */
  find(digits: string): TariffEntry | undefined {
    const i = this.byCode.get(digits);
    return i === undefined ? undefined : this.entries[i];
  }

  /** The HS subheading exists (international, the same in every schedule). */
  hasSubheading(code6: string): boolean {
    return this.hs6.has(code6);
  }

  /** The heading exists: some code starts with these 4 digits. */
  hasHeading(code4: string): boolean {
    return this.headingEntry(code4) !== undefined;
  }

  /**
   * A full code (8 or 10 digits) is in this schedule. Chapters 98 and 99 are national only, so a
   * code there is checked whatever its length.
   */
  hasCode(digits: string): boolean {
    return this.byCode.has(digits) && (digits.length >= 8 || isNationalChapter(digits));
  }

  /** Descriptions from the top of the tree down to this entry, skipping grouping rows' trailing colons. */
  path(entry: TariffEntry): string[] {
    const out: string[] = [];
    for (let e: TariffEntry | undefined = entry; e; e = e.parent >= 0 ? this.entries[e.parent] : undefined) out.unshift(e.description.replace(/:$/, ''));
    return out;
  }

  /** "Heading wording — ... — this code's wording", for findings and the UI. */
  describe(digits: string, max = 300): string | undefined {
    const entry = this.find(digits) ?? this.shallowest(digits);
    if (!entry) return undefined;
    return clip(this.path(entry).join(' — '), max);
  }

  headingEntry(code4: string): TariffEntry | undefined {
    return this.shallowest(code4);
  }

  /** The highest entry whose code starts with `prefix`. */
  private shallowest(prefix: string): TariffEntry | undefined {
    const exact = this.find(prefix);
    if (exact) return exact;
    if (prefix.length === 4) return this.headings.has(prefix) ? this.entries[this.headings.get(prefix)!] : undefined;
    const under = prefix.length === 6 ? (this.hs6.get(prefix) ?? []).map((i) => this.entries[i]) : this.entries.filter((e) => e.code.startsWith(prefix));
    return under.reduce<TariffEntry | undefined>((best, e) => (!best || e.code.length < best.code.length ? e : best), undefined);
  }

  /** Every HS subheading in the schedule, with the text the search ranks. */
  subheadings(): Subheading[] {
    this.subheadingList ??= [...this.hs6.entries()].map(([code, indexes]) => {
      const heading = this.headingEntry(code.slice(0, 4));
      const top = indexes.map((i) => this.entries[i]).reduce((a, b) => (b.code.length < a.code.length ? b : a));
      const path = this.path(top);
      // The heading text plus every distinct wording below it: "Other" says nothing, a leaf like "Dolls" does.
      const words = new Set<string>();
      for (const i of indexes) for (const d of this.path(this.entries[i]).slice(1)) if (!/^Other\b/i.test(d)) words.add(d);
      return {
        code,
        heading: code.slice(0, 4),
        chapter: code.slice(0, 2),
        title: clip(path.join(' — '), 300),
        text: clip(`${heading?.description ?? path[0]}\n${[...words].join('; ')}`, 1500),
      };
    });
    return this.subheadingList;
  }

  /**
   * Every tariff line (8 and 10 digits) with its full path, the unit the embedding index is built
   * on: "Toys ... > Stuffed toys > Under 3 years of age" is closer to an invoice description than the
   * subheading's general wording, and each line counts for its subheading.
   */
  lines(): { code: string; text: string }[] {
    return this.entries.filter((e) => e.code.length >= 8 && !isNationalChapter(e.code)).map((e) => ({ code: e.code, text: clip(this.path(e).join(' > '), 600) }));
  }

  label(digits: string): string {
    return `${this.id === 'US' ? 'HTSUS' : 'Customs Tariff'} ${formatHs(digits)}`;
  }
}
