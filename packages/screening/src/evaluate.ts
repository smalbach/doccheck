import type { ShipmentContext } from '@doccheck/rules';
import type { Party } from '@doccheck/schemas';
import type { ScreeningIndex } from './matcher';
import { screenShipment } from './screen';
import { isLatin, nameTokens } from './text';
import { DEFAULT_THRESHOLDS, type ListEntry, type ScreeningThresholds } from './types';

/** How an injected list name is written on the document. */
export const VARIANTS = ['exact', 'case-and-legal-form', 'alias', 'typo', 'extra-word', 'word-order'] as const;
export type Variant = (typeof VARIANTS)[number];
/** Variants a screening tool must catch as a hit (S1), not merely as a possible match. */
export const STRONG_VARIANTS: readonly Variant[] = ['exact', 'case-and-legal-form', 'alias', 'word-order'];

const ROLES = ['invoice.seller', 'invoice.buyer', 'billOfLading.notifyParty', 'billOfLading.shipper', 'isf.manufacturer'] as const;

/** Seeded, so the same set is built every time. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** The name as a document would print it. */
export function writeVariant(entry: ListEntry, variant: Variant, rand: () => number): string {
  const name = entry.name;
  switch (variant) {
    case 'exact':
      return name;
    case 'case-and-legal-form': {
      const base = name.replace(/[,\s]*\b(co\.?,?\s*ltd\.?|ltd\.?|inc\.?|llc|corp(oration)?\.?|oao|ooo|gmbh|s\.?a\.?|ag)\s*$/i, '');
      return `${base.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())} ${['Co., Ltd.', 'Limited', 'LLC', 'Inc.'][Math.floor(rand() * 4)]}`;
    }
    case 'alias':
      // Invoices print Latin script: an alias in another script is not what a document would show.
      return entry.aliases.find((a) => isLatin(a) && (nameTokens(a).length > 1 || a.length > 5)) ?? name;
    case 'typo': {
      // Swap two letters inside the longest word: "HUAWEI" -> "HUAEWI".
      const words = name.split(' ');
      const i = words.reduce((best, w, k) => (w.length > words[best].length ? k : best), 0);
      const w = words[i];
      if (w.length < 5) return name;
      const at = 2 + Math.floor(rand() * (w.length - 4));
      words[i] = w.slice(0, at) + w[at + 1] + w[at] + w.slice(at + 2);
      return words.join(' ');
    }
    case 'extra-word':
      return `${name} ${['Trading', 'International', 'Group', 'Industrial'][Math.floor(rand() * 4)]}`;
    case 'word-order': {
      const words = name.replace(/,/g, '').split(' ');
      return words.length > 1 ? [...words.slice(1), words[0]].join(' ') : name;
    }
  }
}

/** A company that shares one distinctive word with a listed name and nothing else: must not match. */
export function decoyName(entry: ListEntry, rand: () => number): string | undefined {
  const tokens = nameTokens(entry.name).filter((t) => t.length >= 4);
  if (tokens.length < 2) return undefined;
  const word = tokens[Math.floor(rand() * tokens.length)];
  const cased = word[0] + word.slice(1).toLowerCase();
  return `${cased} ${['Coffee Importers LLC', 'Pacific Supply Co.', 'Garden Furniture Ltd.', 'Bicycle Parts GmbH'][Math.floor(rand() * 4)]}`;
}

export interface EvalCase {
  shipmentId: string;
  kind: 'injected' | 'decoy' | 'clean';
  variant?: Variant;
  role?: string;
  written?: string;
  /** The entry injected, or the entry the decoy borrows a word from. */
  entry?: { list: string; id: string; name: string };
  /** What screening reported: rule, list, entry and score of each S1/S2 finding. */
  got: { ruleId: string; party: string; list: string; entryId: string; name: string; score: number }[];
}

export interface EvalReport {
  thresholds: ScreeningThresholds;
  lists: { entries: number; source: string };
  shipments: number;
  injected: number;
  /** Injected names flagged (S1 or S2) with the right entry, by variant. */
  recall: Record<string, { cases: number; flagged: number; hit: number }>;
  /**
   * Of every S1/S2 finding, the share on the injected party. A finding on any other party (the
   * invented ones, the decoys) is a false positive. The injected party may also match the same
   * company on other lists, or a related one (a subsidiary, a front): those count as right.
   */
  precision: { findings: number; correct: number; s1Findings: number; s1Correct: number };
  falsePositives: EvalCase[];
  misses: EvalCase[];
}

function setParty(ctx: ShipmentContext, role: string, party: Party): boolean {
  const [doc, field] = role.split('.') as [keyof ShipmentContext, string];
  const slot = ctx[doc] as { data: Record<string, unknown> } | undefined;
  if (!slot) return false;
  slot.data[field] = party;
  return true;
}

/**
 * Screens the shipments as they are (no list party in them: every S1/S2 is a false positive),
 * then once more with one party replaced by a list entry written one of the VARIANTS ways, and
 * once with a decoy that shares a word with a list entry. Entries are the index's entities.
 */
export function evaluateScreening(
  shipments: ShipmentContext[],
  index: ScreeningIndex,
  opts: { thresholds?: Partial<ScreeningThresholds>; inject?: ListEntry[]; seed?: number; source?: string } = {},
): EvalReport {
  const thresholds = { ...DEFAULT_THRESHOLDS, ...opts.thresholds };
  const rand = rng(opts.seed ?? 20261016);
  const pool = (opts.inject ?? index.entries.filter((e) => e.type === 'entity' && nameTokens(e.name).join('').length >= 6)).slice();
  const cases: EvalCase[] = [];
  const run = (ctx: ShipmentContext, c: Omit<EvalCase, 'got'>) => {
    const out = screenShipment(ctx, index, { thresholds });
    const got = out.hits.map((h) => ({ ruleId: h.ruleId, party: h.party, list: h.list, entryId: h.entryId, name: h.entryName, score: h.score }));
    cases.push({ ...c, got });
  };

  shipments.forEach((s, i) => {
    run(s, { shipmentId: s.shipmentId, kind: 'clean' });
    if (pool.length === 0) return;
    const entry = pool[i % pool.length];
    const variant = VARIANTS[i % VARIANTS.length];
    const roles = ROLES.filter((r) => r !== 'isf.manufacturer' || s.isf);
    const role = roles[Math.floor(rand() * roles.length)];
    const written = writeVariant(entry, variant, rand);
    const injected = structuredClone(s);
    // A party of its own, at an address the list does not give (the name alone must carry the match).
    if (setParty(injected, role, { name: written, address: { lines: ['Room 1201, Block B'], city: 'Unlisted City' } })) {
      run(injected, { shipmentId: s.shipmentId, kind: 'injected', variant, role, written, entry: { list: entry.list, id: entry.id, name: entry.name } });
    }
    const decoy = decoyName(entry, rand);
    if (decoy) {
      const ctx = structuredClone(s);
      if (setParty(ctx, 'invoice.buyer', { name: decoy, address: { lines: ['1 Harbour Rd'], city: 'Unlisted City' } })) {
        run(ctx, { shipmentId: s.shipmentId, kind: 'decoy', written: decoy, entry: { list: entry.list, id: entry.id, name: entry.name } });
      }
    }
  });

  const onInjected = (c: EvalCase, g: EvalCase['got'][number]) => c.kind === 'injected' && g.party === c.written;
  const isEntry = (c: EvalCase, g: EvalCase['got'][number]) => onInjected(c, g) && !!c.entry && g.list === c.entry.list && g.entryId === c.entry.id;
  const recall: EvalReport['recall'] = {};
  const precision = { findings: 0, correct: 0, s1Findings: 0, s1Correct: 0 };
  const falsePositives: EvalCase[] = [];
  const misses: EvalCase[] = [];
  for (const c of cases) {
    for (const g of c.got) {
      const correct = onInjected(c, g);
      precision.findings++;
      if (correct) precision.correct++;
      if (g.ruleId === 'S1') {
        precision.s1Findings++;
        if (correct) precision.s1Correct++;
      }
    }
    if (c.got.some((g) => !onInjected(c, g))) falsePositives.push({ ...c, got: c.got.filter((g) => !onInjected(c, g)) });
    if (c.kind !== 'injected') continue;
    const r = (recall[c.variant!] ??= { cases: 0, flagged: 0, hit: 0 });
    r.cases++;
    // Recall asks for the injected entry itself among the findings.
    const found = c.got.filter((g) => isEntry(c, g));
    if (found.length) r.flagged++;
    if (found.some((g) => g.ruleId === 'S1')) r.hit++;
    if (!found.length || (STRONG_VARIANTS.includes(c.variant!) && !found.some((g) => g.ruleId === 'S1'))) misses.push(c);
  }
  return {
    thresholds,
    lists: { entries: index.size, source: opts.source ?? 'fixture' },
    shipments: shipments.length,
    injected: cases.filter((c) => c.kind === 'injected').length,
    recall,
    precision,
    falsePositives,
    misses,
  };
}
