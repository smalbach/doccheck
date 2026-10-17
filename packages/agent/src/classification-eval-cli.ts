import { LlmClient, llmFromEnv } from '@doccheck/extraction';
import { embedderFromEnv, indexName } from '@doccheck/regulations';
import { findTariffDir, formatHs, headingRef, loadTariffData, MemoryVectors, TariffSearch, vectorIndexFile } from '@doccheck/tariff';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { CLASSIFICATION_PROMPT_VERSION, judgeHeading, suggestHeadings, suggestionCandidates, type ClassificationResources } from './classification';

/**
 * Tariff classification evaluation on goods with a known HS subheading: those of the synthetic set plus
 * common goods across chapters. Three measures, on the US schedule (the HS headings are the same in both):
 *  - retrieval: the right heading among the search's top 5 subheadings, for each description;
 *  - fit (agent rule A2): "does the description fit heading X?" with the right heading (expected yes)
 *    and with a wrong one (expected no): half from another section, half a classic trap that a
 *    chapter note excludes (a child's bicycle as a toy);
 *  - suggestion: the right heading among the model's top 3 for a line without a code.
 * The labeled cases are written to data/eval/classification/cases.json. Writes
 * eval/reports/classification-<model>.{md,json}; model answers are cached like the other evaluations.
 */

export interface GoodsCase {
  description: string;
  /** The right subheading, "9503.00". */
  hs: string;
  /** A heading it is easy to put it in by mistake, that a note or the heading text excludes. */
  trap?: string;
}

/** Common goods outside the synthetic catalog, with their subheading. */
const MORE_GOODS: GoodsCase[] = [
  { description: 'Laptop computer, 14 inch screen, 1.4 kg', hs: '8471.30' },
  { description: 'Smartphone, 6.1 inch display, 128 GB', hs: '8517.13' },
  { description: "Men's dress shoes, leather uppers, rubber soles", hs: '6403.99' },
  { description: "Women's handbag with outer surface of leather", hs: '4202.21' },
  { description: 'Set of 5 kitchen knives, stainless steel, in wooden block', hs: '8211.10' },
  { description: 'LED light bulbs E27, 9 W', hs: '8539.52' },
  { description: 'Wooden dining chairs, not upholstered', hs: '9401.69' },
  { description: 'Frozen shrimp, peeled and deveined', hs: '0306.17' },
  { description: 'Red wine, 750 ml bottles, 13% vol', hs: '2204.21' },
  { description: "Children's bicycle, 16 inch wheels", hs: '8712.00', trap: '9503' },
  { description: 'New radial car tires 205/55R16', hs: '4011.10' },
  { description: 'Cotton bath towels, terry weave', hs: '6302.60' },
  { description: 'Quartz wristwatch, stainless steel case', hs: '9102.11' },
  { description: 'Acoustic guitar, spruce top', hs: '9202.90' },
  { description: 'Household vacuum cleaner with bag, 1200 W', hs: '8508.11' },
  { description: 'Paperback novels, printed', hs: '4901.99' },
  { description: 'Golf balls, 12-pack', hs: '9506.32' },
  { description: 'Natural honey, 500 g jars', hs: '0409.00' },
  { description: 'Grey Portland cement, 50 kg bags', hs: '2523.29' },
  { description: 'Polyethylene shopping bags', hs: '3923.21' },
  { description: 'Sunglasses with UV400 lenses', hs: '9004.10', trap: '9506' },
  { description: 'Ceramic coffee mugs, porcelain', hs: '6911.10' },
  { description: 'Fresh apples, Gala, in cartons', hs: '0808.10' },
  { description: 'Lithium-ion battery pack 36 V for e-bikes', hs: '8507.60' },
  { description: 'Photovoltaic solar panels, 400 W modules', hs: '8541.43' },
  { description: 'Baby bodysuits, knitted cotton', hs: '6111.20' },
  { description: 'Running shoes, textile uppers, rubber soles', hs: '6404.11', trap: '9506' },
  { description: 'Microwave oven, 20 L, household', hs: '8516.50', trap: '8419' },
];

/** Traps for goods of the synthetic set, by subheading. */
const SYNTH_TRAPS: Record<string, string> = { '9503.00': '6307', '6109.10': '6205', '8516.71': '7323', '8482.10': '8483' };

/** The distinct goods on the invoices of the synthetic set (first description of each subheading), then MORE_GOODS. */
export async function buildGoods(dataDir: string): Promise<GoodsCase[]> {
  const seen = new Map<string, GoodsCase>();
  for (const id of (await readdir(dataDir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
    const truth = JSON.parse(await readFile(join(dataDir, id, 'truth.json'), 'utf8')) as { documents: { invoice: { lines: { description: string; hsCode?: string }[] } } };
    for (const l of truth.documents.invoice.lines) {
      if (l.hsCode && !seen.has(l.hsCode)) seen.set(l.hsCode, { description: l.description, hs: l.hsCode, ...(SYNTH_TRAPS[l.hsCode] ? { trap: SYNTH_TRAPS[l.hsCode] } : {}) });
    }
  }
  return [...seen.values(), ...MORE_GOODS];
}

export interface FitCase {
  id: string;
  description: string;
  heading: string;
  expected: 'yes' | 'no';
  why: 'right' | 'other-section' | 'trap';
}

/** Each good with its own heading (yes), and with a wrong one (no): the trap if it has one, otherwise a heading from another chapter. */
export function buildFitCases(goods: GoodsCase[]): FitCase[] {
  return goods.flatMap((g, i) => {
    const own = g.hs.replace(/\D/g, '').slice(0, 4);
    // Deterministic "other" heading: a good some way down the list, from a different chapter.
    const other = [...goods.slice(i + 7), ...goods.slice(0, i + 7)].find((o) => o.hs.slice(0, 2) !== g.hs.slice(0, 2))!.hs.replace(/\D/g, '').slice(0, 4);
    return [
      { id: `${i}:right`, description: g.description, heading: own, expected: 'yes' as const, why: 'right' as const },
      g.trap
        ? { id: `${i}:trap`, description: g.description, heading: g.trap, expected: 'no' as const, why: 'trap' as const }
        : { id: `${i}:other`, description: g.description, heading: other, expected: 'no' as const, why: 'other-section' as const },
    ];
  });
}

async function main() {
  const { values } = parseArgs({ options: { data: { type: 'string', default: 'data/eval/v1' }, out: { type: 'string', default: 'eval/reports' }, cases: { type: 'string', default: 'data/eval/classification' } } });
  const dir = findTariffDir();
  if (!dir) throw new Error('No tariff data: run npm run tariff:fetch');
  const base = llmFromEnv();
  const llm = new LlmClient(base.provider, process.env.LLM_CACHE_DIR || join('eval/cache', `agent-${base.provider.id.replace(/[^\w.-]+/g, '_')}`), (process.env.LLM_CACHE_MODE as 'readwrite' | 'replay') || 'readwrite');
  const { schedule, notes } = await loadTariffData(dir, 'US');
  const embedder = embedderFromEnv();
  const indexFile = vectorIndexFile(dir, 'US', indexName(embedder.id));
  const vectors = existsSync(indexFile) ? await MemoryVectors.load(indexFile, embedder) : undefined;
  const res: ClassificationResources = { schedule, notes, search: new TariffSearch(schedule, vectors) };
  const goods = await buildGoods(resolve(values.data!));
  const fitCases = buildFitCases(goods);
  await mkdir(resolve(values.cases!), { recursive: true });
  await writeFile(join(resolve(values.cases!), 'cases.json'), JSON.stringify({ goods, fit: fitCases }, null, 2) + '\n');

  const headingText = (d4: string) => {
    const chapter = notes.chapterTitle(d4.slice(0, 2));
    return { code: headingRef(d4), text: `${schedule.headingEntry(d4)?.description ?? ''}${chapter ? ` (Chapter ${Number(d4.slice(0, 2))}: ${chapter})` : ''}` };
  };
  const started = Date.now();

  // Retrieval: is the right heading among the top 5 subheadings?
  const retrieval: { description: string; hs: string; rank: number | null; exact: boolean; top: string[] }[] = [];
  for (const g of goods) {
    const top = await res.search.search(g.description, { limit: 8 });
    const want = g.hs.replace(/\D/g, '');
    const rank = top.findIndex((c) => c.heading === want.slice(0, 4));
    retrieval.push({ description: g.description, hs: g.hs, rank: rank < 0 ? null : rank + 1, exact: top.slice(0, 5).some((c) => c.code === want), top: top.slice(0, 5).map((c) => formatHs(c.code)) });
  }

  // Fit questions, with notes and alternatives chosen as the review does.
  const fit: (FitCase & { verdict: string; confidence: number; rationale: string; correct: boolean; effectCorrect: boolean })[] = [];
  for (const c of fitCases) {
    const candidates = await res.search.search(c.description, { limit: 8 });
    // Same order as the review: headings a note of the declared chapter points to first.
    const pointed = (h: string) => notes.pointingTo(c.heading.slice(0, 2), h).length > 0;
    const others = [...new Set(candidates.filter((x) => x.heading !== c.heading).sort((a, b) => Number(pointed(b.heading)) - Number(pointed(a.heading))).map((x) => x.heading))].slice(0, 3);
    const chapters = [c.heading.slice(0, 2), ...others.map((h) => h.slice(0, 2))];
    const pointing = others.flatMap((h) => notes.pointingTo(c.heading.slice(0, 2), h));
    const shown = [...new Map([...pointing, ...notes.relevant(c.description, chapters, 3)].map((n) => [n.ref, n])).values()].slice(0, 4);
    try {
      const { output: o } = await judgeHeading(llm, c.description, headingText(c.heading), shown.map((n) => ({ ref: n.ref, text: n.text.length > 400 ? `${n.text.slice(0, 399)}…` : n.text })), others.map(headingText));
      const acts = o.fits === 'no' && o.confidence >= 0.7;
      fit.push({ ...c, verdict: o.fits, confidence: o.confidence, rationale: o.rationale, correct: o.fits === c.expected, effectCorrect: acts === (c.expected === 'no') });
    } catch (err) {
      fit.push({ ...c, verdict: 'error', confidence: 0, rationale: err instanceof Error ? err.message : String(err), correct: false, effectCorrect: false });
    }
  }

  // Suggestions for lines without a code.
  const suggest: { description: string; hs: string; terms?: string; inCandidates: boolean; picked: string[]; headingTop3: boolean; exactTop1: boolean; error?: string }[] = [];
  for (const g of goods) {
    const want = g.hs.replace(/\D/g, '');
    try {
      const { candidates, terms } = await suggestionCandidates(llm, res.search, g.description);
      const { output } = await suggestHeadings(llm, g.description, candidates.map((c) => ({ code: formatHs(c.code), text: c.title })), notes.relevant(g.description, [...new Set(candidates.slice(0, 3).map((c) => c.chapter))], 3).map((n) => ({ ref: n.ref, text: n.text.slice(0, 400) })));
      const offered = new Set(candidates.map((c) => c.code));
      const picked = output.candidates.map((s) => s.code.replace(/\D/g, '').slice(0, 6)).filter((c) => offered.has(c));
      suggest.push({ description: g.description, hs: g.hs, terms, inCandidates: offered.has(want) || candidates.some((c) => c.heading === want.slice(0, 4)), picked: picked.map(formatHs), headingTop3: picked.some((p) => p.slice(0, 4) === want.slice(0, 4)), exactTop1: picked[0] === want });
    } catch (err) {
      suggest.push({ description: g.description, hs: g.hs, inCandidates: false, picked: [], headingTop3: false, exactTop1: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const share = (n: number, d: number) => (d ? n / d : 0);
  const answered = fit.filter((f) => f.verdict === 'yes' || f.verdict === 'no');
  const summary = {
    retrieval: { cases: retrieval.length, headingAt5: share(retrieval.filter((r) => r.rank !== null && r.rank <= 5).length, retrieval.length), subheadingAt5: share(retrieval.filter((r) => r.exact).length, retrieval.length), mode: vectors ? 'hybrid' : 'keywords' },
    fit: {
      cases: fit.length,
      accuracy: share(fit.filter((f) => f.correct).length, fit.length),
      answered: answered.length,
      accuracyWhenAnswered: share(answered.filter((f) => f.correct).length, answered.length),
      wrong: answered.filter((f) => !f.correct).length,
      unsure: fit.filter((f) => f.verdict === 'unsure').length,
      effectAccuracy: share(fit.filter((f) => f.effectCorrect).length, fit.length),
      byKind: (['right', 'other-section', 'trap'] as const).map((why) => ({ why, cases: fit.filter((f) => f.why === why).length, accuracy: share(fit.filter((f) => f.why === why && f.correct).length, fit.filter((f) => f.why === why).length) })),
    },
    suggest: { cases: suggest.length, headingTop3: share(suggest.filter((s) => s.headingTop3).length, suggest.length), exactTop1: share(suggest.filter((s) => s.exactTop1).length, suggest.length), inCandidates: share(suggest.filter((s) => s.inCandidates).length, suggest.length) },
  };

  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const name = `classification-${base.provider.id.replace(/[^\w.-]+/g, '_')}`;
  const md = [
    `# Tariff classification report — ${base.provider.id}`,
    '',
    `Model build ${(await base.provider.version?.()) ?? 'unknown'} · prompt \`${CLASSIFICATION_PROMPT_VERSION}\` · ${goods.length} goods, ${fitCases.length} fit cases · search ${summary.retrieval.mode} (${schedule.file.edition}) · ${Math.round((Date.now() - started) / 1000)} s`,
    '',
    '| Measure | Cases | Result |',
    '| --- | --- | --- |',
    `| Search: right heading in the top 5 | ${summary.retrieval.cases} | ${pct(summary.retrieval.headingAt5)} (subheading ${pct(summary.retrieval.subheadingAt5)}) |`,
    `| Does the description fit the heading? (A2): verdict | ${summary.fit.cases} | ${pct(summary.fit.accuracy)} (${summary.fit.wrong} wrong, ${summary.fit.unsure} unsure) |`,
    `| A2: right action (finding only for a wrong heading) | ${summary.fit.cases} | ${pct(summary.fit.effectAccuracy)} |`,
    ...summary.fit.byKind.map((k) => `| A2 verdict, ${k.why === 'right' ? 'right heading' : k.why === 'trap' ? 'wrong heading a note excludes' : 'wrong heading from another chapter'} | ${k.cases} | ${pct(k.accuracy)} |`),
    `| Suggestion without a code: right heading in the top 3 | ${summary.suggest.cases} | ${pct(summary.suggest.headingTop3)} (exact subheading first: ${pct(summary.suggest.exactTop1)}; right heading among the candidates: ${pct(summary.suggest.inCandidates)}) |`,
    '',
    'Right action: an A2 finding is added only on a confident "no" (confidence ≥ 0.7); "unsure" adds nothing, which is the right action when the heading is right.',
    '',
    '## Wrong or unsure fit answers',
    '',
    ...fit.filter((f) => !f.correct).map((f) => `- \`${f.id}\` "${f.description}" vs ${headingRef(f.heading)} (${f.why}): expected ${f.expected}, got ${f.verdict} ${f.confidence} — ${f.rationale}`),
    '',
    '## Search misses (right heading not in the top 5)',
    '',
    ...retrieval.filter((r) => r.rank === null || r.rank > 5).map((r) => `- "${r.description}" (${r.hs}): ${r.top.join(', ')}`),
    '',
    '## Suggestions without the right heading',
    '',
    ...suggest.filter((s) => !s.headingTop3).map((s) => `- "${s.description}" (${s.hs}), searched as "${s.terms ?? ''}": ${s.picked.join(', ') || 'none'}${s.error ? ` — ${s.error}` : ''}`),
    '',
  ].join('\n');
  const outDir = resolve(values.out!);
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, `${name}.json`), JSON.stringify({ provider: base.provider.id, modelVersion: await base.provider.version?.(), promptVersion: CLASSIFICATION_PROMPT_VERSION, edition: schedule.file.edition, summary, retrieval, fit, suggest }, null, 2) + '\n');
  await writeFile(join(outDir, `${name}.md`), md);
  console.log(md);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
