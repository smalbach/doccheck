import { LlmClient, llmFromEnv } from '@doccheck/extraction';
import type { BillOfLading, CommercialInvoice, Party } from '@doccheck/schemas';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { AGENT_PROMPT_VERSION, judgeDescription, judgeSameParty } from './review';

/**
 * Agent evaluation on cases with a known answer, built from the synthetic shipments:
 *  - party: the same consignee written differently (abbreviation, typo, word order) -> yes;
 *    a different company from the catalog -> no.
 *  - description: the BL cargo description of the shipment -> consistent; the description from a
 *    shipment of different goods -> not consistent.
 * Writes eval/reports/agent-<model>.{md,json}. Responses are cached like extraction.
 */

interface Case {
  id: string;
  kind: 'party' | 'description';
  expected: 'yes' | 'no';
  run: (llm: LlmClient) => Promise<{ verdict: 'yes' | 'no' | 'unsure'; confidence: number; rationale: string }>;
  input: unknown;
}

/** Ways the same company name gets written on different documents. */
const SAME_PARTY_VARIANTS: ((name: string) => string)[] = [
  (n) => n.replace(/\bIndustrial\b/, 'Ind.').replace(/\bManufacturing\b/, 'Mfg.').replace(/\bSupply\b/, 'Sup.').replace(/\bOutfitters\b/, 'Outfitters').replace(/\bCo-operative\b/, 'Coop'),
  (n) => n.replace(/([aeiou])([a-z])([a-z]{3,})/, '$1$2$2$3'), // a doubled letter: "Harborline" -> "Harrborline"
  (n) => n.replace(/\b(Inc\.|Ltd\.|LLC|Corp\.|Ltée|Co-operative)$/, '').trim() + ' (Import Dept.)',
  (n) => n.toUpperCase().replace(/ AND /g, ' & ').replace(/\bRETAIL\b/, 'RETAILERS'),
];

const describe = (inv: CommercialInvoice) => inv.lines.map((l) => `${l.description} (${l.quantity.value} ${l.quantity.unit})`);

async function buildCases(dataDir: string, n: number): Promise<Case[]> {
  const ids = (await readdir(dataDir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  const shipments: { id: string; invoice: CommercialInvoice; bl: BillOfLading }[] = [];
  for (const id of ids) {
    const t = JSON.parse(await readFile(join(dataDir, id, 'truth.json'), 'utf8'));
    if (t.documents.invoice.consignee) shipments.push({ id, invoice: t.documents.invoice, bl: t.documents.billOfLading });
  }
  // Distinct consignees and goods in the set, to draw "different" counterparts from.
  const parties = [...new Map(shipments.map((s) => [s.invoice.consignee!.name, s.invoice.consignee!])).values()];
  const cases: Case[] = [];
  const pick = shipments.filter((_, i) => i % Math.max(1, Math.floor(shipments.length / n)) === 0).slice(0, n);

  pick.forEach((s, i) => {
    const consignee = s.invoice.consignee!;
    if (i % 2 === 0) {
      // First variant, in rotation, that actually changes this name.
      const variant = [0, 1, 2, 3].map((k) => SAME_PARTY_VARIANTS[(i / 2 + k) % SAME_PARTY_VARIANTS.length](consignee.name)).find((v) => v !== consignee.name)!;
      const other: Party = { ...consignee, name: variant };
      cases.push({ id: `${s.id}:party:same`, kind: 'party', expected: 'yes', input: [consignee.name, variant], run: async (llm) => mapParty(await judgeSameParty(llm, consignee, other, CONTEXT)) });
    } else {
      const different = parties.filter((p) => p.name !== consignee.name)[i % (parties.length - 1)];
      cases.push({ id: `${s.id}:party:different`, kind: 'party', expected: 'no', input: [consignee.name, different.name], run: async (llm) => mapParty(await judgeSameParty(llm, consignee, different, CONTEXT)) });
    }
    if (i % 2 === 0) {
      cases.push({ id: `${s.id}:description:same`, kind: 'description', expected: 'yes', input: [s.bl.cargoDescription, describe(s.invoice)], run: async (llm) => mapDesc(await judgeDescription(llm, s.bl.cargoDescription, describe(s.invoice))) });
    } else {
      const firstWord = (d: string) => d.split(/\s+/)[0].toLowerCase();
      const other = shipments.find((o) => firstWord(o.invoice.lines[0].description) !== firstWord(s.invoice.lines[0].description) && !o.invoice.lines.some((l) => s.invoice.lines.some((m) => m.hsCode === l.hsCode)))!;
      cases.push({ id: `${s.id}:description:different`, kind: 'description', expected: 'no', input: [other.bl.cargoDescription, describe(s.invoice)], run: async (llm) => mapDesc(await judgeDescription(llm, other.bl.cargoDescription, describe(s.invoice))) });
    }
  });
  return cases;
}

const CONTEXT = 'The consignee names differ between two documents of the same shipment.';
const mapParty = (r: { output: { sameParty: 'yes' | 'no' | 'unsure'; confidence: number; rationale: string } }) => ({ verdict: r.output.sameParty, confidence: r.output.confidence, rationale: r.output.rationale });
const mapDesc = (r: { output: { consistent: 'yes' | 'no' | 'unsure'; confidence: number; rationale: string } }) => ({ verdict: r.output.consistent, confidence: r.output.confidence, rationale: r.output.rationale });

async function main() {
  const { values } = parseArgs({ options: { data: { type: 'string', default: 'data/eval/v1' }, out: { type: 'string', default: 'eval/reports' }, cases: { type: 'string', default: '40' } } });
  const base = llmFromEnv();
  const llm = new LlmClient(base.provider, process.env.LLM_CACHE_DIR || join('eval/cache', `agent-${base.provider.id.replace(/[^\w.-]+/g, '_')}`), (process.env.LLM_CACHE_MODE as 'readwrite' | 'replay') || 'readwrite');
  const cases = await buildCases(resolve(values.data!), Number(values.cases));
  console.log(`Running ${cases.length} agent cases with ${base.provider.id}`);

  const results: { id: string; kind: Case['kind']; expected: string; input: unknown; verdict: string; confidence: number; rationale: string; correct: boolean; effectCorrect: boolean }[] = [];
  const started = Date.now();
  for (const c of cases) {
    try {
      const r = await c.run(llm);
      // What the review does with the verdict: X1 dismisses only on a confident "yes", A1 adds a finding only on a confident "no".
      const acts = c.kind === 'party' ? r.verdict === 'yes' && r.confidence >= 0.7 : r.verdict === 'no' && r.confidence >= 0.7;
      const shouldAct = c.kind === 'party' ? c.expected === 'yes' : c.expected === 'no';
      results.push({ id: c.id, kind: c.kind, expected: c.expected, input: c.input, ...r, correct: r.verdict === c.expected, effectCorrect: acts === shouldAct });
    } catch (err) {
      results.push({ id: c.id, kind: c.kind, expected: c.expected, input: c.input, verdict: 'error', confidence: 0, rationale: err instanceof Error ? err.message : String(err), correct: false, effectCorrect: false });
    }
  }

  const rows = (['party', 'description'] as const).map((kind) => {
    const r = results.filter((x) => x.kind === kind);
    const answered = r.filter((x) => x.verdict === 'yes' || x.verdict === 'no');
    return {
      kind,
      cases: r.length,
      accuracy: r.length ? r.filter((x) => x.correct).length / r.length : 0,
      answered: answered.length,
      accuracyWhenAnswered: answered.length ? answered.filter((x) => x.correct).length / answered.length : 0,
      wrong: answered.filter((x) => !x.correct).length,
      unsure: r.filter((x) => x.verdict === 'unsure').length,
      effectAccuracy: r.length ? r.filter((x) => x.effectCorrect).length / r.length : 0,
    };
  });
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const name = `agent-${base.provider.id.replace(/[^\w.-]+/g, '_')}`;
  const md = [
    `# Agent report — ${base.provider.id}`,
    '',
    `Model build ${(await base.provider.version?.()) ?? 'unknown'} · prompt \`${AGENT_PROMPT_VERSION}\` · ${cases.length} cases · ${Math.round((Date.now() - started) / 1000)} s`,
    '',
    '| Decision | Cases | Verdict accuracy | When answered | Wrong | Unsure | Right action on the finding |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map((r) => `| ${r.kind === 'party' ? 'Same consignee? (X1)' : 'BL description consistent? (A1)'} | ${r.cases} | ${pct(r.accuracy)} | ${pct(r.accuracyWhenAnswered)} | ${r.wrong} | ${r.unsure} | ${pct(r.effectAccuracy)} |`),
    '',
    'Right action: X1 findings dismissed only for the same company, A1 findings added only for different goods. "Unsure" keeps the rule finding, so it is the right action whenever the companies differ.',
    '',
    '## Wrong or unsure',
    '',
    ...results.filter((r) => !r.correct).map((r) => `- \`${r.id}\` expected ${r.expected}, got ${r.verdict}: ${JSON.stringify(r.input)} — ${r.rationale}`),
    '',
  ].join('\n');
  const outDir = resolve(values.out!);
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, `${name}.json`), JSON.stringify({ provider: base.provider.id, modelVersion: await base.provider.version?.(), promptVersion: AGENT_PROMPT_VERSION, summary: rows, results }, null, 2) + '\n');
  await writeFile(join(outDir, `${name}.md`), md);
  console.log(md);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
