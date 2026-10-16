import { LIST_IDS } from './sources';
import { jaroWinkler, nameTokens, partyKey } from './text';
import type { ListEntry } from './types';

/** A party as printed on a document, the thing screened. */
export interface PartyQuery {
  name: string;
  country?: string;
  city?: string;
}

export interface Match {
  entry: ListEntry;
  /** The entry's name or alias that scored best. */
  matchedName: string;
  /** 0..1, rounded to 3 decimals: name similarity plus the country and city adjustments. */
  score: number;
  /** Name similarity alone. */
  nameScore: number;
  /** +0.03 same country, -0.05 the entry lists only other countries, 0 when either side has none. */
  countryAdjust: number;
  /** +0.02 when the party's city appears in one of the entry's addresses. */
  cityAdjust: number;
}

/** Two tokens closer than this (Jaro-Winkler) count as the same word misspelt. */
const TOKEN_SIMILARITY = 0.88;
const COUNTRY_BONUS = 0.03;
const COUNTRY_PENALTY = -0.05;
const CITY_BONUS = 0.02;
/** A token in more than this share of entries ("TRADING", "INTERNATIONAL") does not select candidates alone. */
const COMMON_SHARE = 0.02;
/** Prefix buckets larger than this are too vague to select candidates. */
const MAX_PREFIX_BUCKET = 3000;

interface Variant {
  entry: number;
  name: string;
  tokens: string[];
  key: string;
  compact: string;
  /** Short names ("ADF", "NALU") match only when written exactly the same. */
  exactOnly: boolean;
}

const anagram = (t: string) => [...t].sort().join('');

const round = (x: number) => Math.round(x * 1000) / 1000;

const tokenSimilarity = (a: string, b: string): number => {
  if (a === b) return 1;
  if (a.length <= 3 || b.length <= 3) return 0;
  // A misspelling keeps the length roughly: "INDUSTRIAL" is not "INDIA".
  if (Math.min(a.length, b.length) / Math.max(a.length, b.length) < 0.75) return 0;
  const s = jaroWinkler(a, b);
  return s >= TOKEN_SIMILARITY ? s : 0;
};

/**
 * In-memory index of every cached list entry, built once per refresh. Matching is deterministic:
 * the same lists and the same party always give the same matches, in the same order.
 *
 * Name score: both names are tokenized after the X1 normalization (case, accents, punctuation,
 * legal form) and each token is weighted by how rare it is across all entries (inverse document
 * frequency), so "XINJIANG" or "HUAFU" count for more than "TRADING". Each side's tokens find their
 * most similar token on the other side (Jaro-Winkler, a misspelt word still counts); the score is
 * the mean of both weighted coverages, so extra words on either side lower it. Names that only
 * differ in spacing ("HUA WEI" / "HUAWEI") score 1.
 */
export class ScreeningIndex {
  private readonly variants: Variant[] = [];
  private readonly postings = new Map<string, number[]>();
  private readonly df = new Map<string, number>();
  private readonly n: number;

  constructor(readonly entries: readonly ListEntry[]) {
    entries.forEach((entry, i) => {
      if (entry.type === 'vessel' || entry.type === 'aircraft') return;
      const seen = new Set<string>();
      for (const name of [entry.name, ...entry.aliases]) {
        const tokens = nameTokens(name);
        if (tokens.length === 0) continue;
        const key = partyKey(name);
        if (seen.has(`=${key}`)) continue;
        seen.add(`=${key}`);
        const compact = tokens.join('');
        const id = this.variants.length;
        this.variants.push({ entry: i, name, tokens, key, compact, exactOnly: compact.length < 4 || (tokens.length === 1 && tokens[0].length <= 3) });
        for (const t of new Set(tokens)) {
          this.post(t, id);
          if (t.length >= 5) this.post(`P:${t.slice(0, 4)}`, id);
          if (t.length >= 4) this.post(`A:${anagram(t)}`, id);
          if (!seen.has(t)) {
            seen.add(t);
            this.df.set(t, (this.df.get(t) ?? 0) + 1);
          }
        }
        this.post(`C:${compact}`, id);
      }
    });
    this.n = Math.max(1, entries.length);
  }

  get size(): number {
    return this.entries.length;
  }

  private post(key: string, id: number) {
    const list = this.postings.get(key);
    if (!list) this.postings.set(key, [id]);
    else if (list[list.length - 1] !== id) list.push(id);
  }

  /** Inverse document frequency: rare tokens weigh more. A token no entry has weighs the most. */
  private weight(token: string): number {
    return Math.log(1 + this.n / (this.df.get(token) ?? 0.5));
  }

  private coverage(from: string[], to: string[]): number {
    let total = 0;
    let covered = 0;
    for (const a of from) {
      const w = this.weight(a);
      total += w;
      let best = 0;
      for (const b of to) {
        best = Math.max(best, tokenSimilarity(a, b));
        if (best === 1) break;
      }
      covered += w * best;
    }
    return total === 0 ? 0 : covered / total;
  }

  /** Name similarity of two token lists, 0..1. */
  nameSimilarity(query: string[], candidate: string[]): number {
    return (this.coverage(query, candidate) + this.coverage(candidate, query)) / 2;
  }

  private candidates(tokens: string[], compact: string): Set<number> {
    const out = new Set<number>();
    const add = (key: string, cap = Infinity) => {
      const list = this.postings.get(key);
      if (list && list.length <= cap) for (const id of list) out.add(id);
    };
    const common = Math.max(50, this.n * COMMON_SHARE);
    const rare = tokens.filter((t) => (this.df.get(t) ?? 0) <= common);
    for (const t of rare.length > 0 ? rare : tokens) {
      add(t);
      if (t.length >= 5) add(`P:${t.slice(0, 4)}`, MAX_PREFIX_BUCKET);
      // Same letters in another order: catches swapped letters early in the word ("CIEMX").
      if (t.length >= 4) add(`A:${anagram(t)}`, MAX_PREFIX_BUCKET);
    }
    add(`C:${compact}`);
    return out;
  }

  /** Entries whose score reaches `minScore`, best first (ties by list order, then entry id). */
  search(query: PartyQuery, opts: { minScore?: number; limit?: number } = {}): Match[] {
    const minScore = opts.minScore ?? 0.5;
    const tokens = nameTokens(query.name);
    if (tokens.length === 0 || tokens.every((t) => t.length <= 2)) return [];
    const key = partyKey(query.name);
    const compact = tokens.join('');
    const cityTokens = query.city ? nameTokens(query.city) : [];
    const best = new Map<number, Match>();
    for (const id of this.candidates(tokens, compact)) {
      const v = this.variants[id];
      let nameScore: number;
      if (v.key === key || v.compact === compact) nameScore = 1;
      else if (v.exactOnly) continue;
      else nameScore = this.nameSimilarity(tokens, v.tokens);
      if (nameScore + COUNTRY_BONUS + CITY_BONUS < minScore) continue;
      const entry = this.entries[v.entry];
      const countryAdjust = !query.country || entry.countries.length === 0 ? 0 : entry.countries.includes(query.country) ? COUNTRY_BONUS : COUNTRY_PENALTY;
      const cityAdjust =
        cityTokens.length > 0 && entry.addresses.some((a) => {
          const words = new Set(nameTokens(`${a.city ?? ''} ${a.text}`));
          return cityTokens.every((t) => words.has(t));
        })
          ? CITY_BONUS
          : 0;
      const score = round(Math.min(1, Math.max(0, nameScore + countryAdjust + cityAdjust)));
      if (score < minScore) continue;
      const seen = best.get(v.entry);
      if (!seen || score > seen.score || (score === seen.score && nameScore > seen.nameScore)) {
        best.set(v.entry, { entry, matchedName: v.name, score, nameScore: round(nameScore), countryAdjust, cityAdjust });
      }
    }
    const order = (list: string) => {
      const i = LIST_IDS.indexOf(list);
      return i < 0 ? LIST_IDS.length : i;
    };
    return [...best.values()]
      .sort((a, b) => b.score - a.score || order(a.entry.list) - order(b.entry.list) || a.entry.id.localeCompare(b.entry.id))
      .slice(0, opts.limit ?? 10);
  }
}
