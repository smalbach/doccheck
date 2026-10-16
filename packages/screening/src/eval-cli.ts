import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { ShipmentContext } from '@doccheck/rules';
import { evaluateScreening, STRONG_VARIANTS, VARIANTS, type EvalReport } from './evaluate';
import { loadScreening } from './load';

/**
 * Screening evaluation: the synthetic shipments (their parties are invented, so any S1/S2 on them
 * is a false positive), each also with one party replaced by a list entry written in one of several
 * ways and with a decoy sharing a word with one. Writes eval/reports/screening-<lists>.json and .md.
 *
 *   node dist/eval-cli.js [--lists fixtures|data/screening] [--sets v1,v2] [--match 0.92] [--review 0.82]
 */
const { values } = parseArgs({
  options: {
    lists: { type: 'string', default: 'fixtures' },
    sets: { type: 'string', default: 'v1,v2' },
    eval: { type: 'string', default: 'data/eval' },
    out: { type: 'string', default: 'eval/reports' },
    match: { type: 'string' },
    review: { type: 'string' },
  },
});

const root = [process.cwd(), resolve(__dirname, '../../..')].find((d) => existsSync(join(d, 'data/eval'))) ?? process.cwd();
const listsDir = values.lists === 'fixtures' ? resolve(__dirname, '../fixtures') : resolve(root, values.lists);
const source = values.lists === 'fixtures' ? 'fixture' : 'full';

async function shipments(): Promise<ShipmentContext[]> {
  const out: ShipmentContext[] = [];
  for (const set of values.sets.split(',')) {
    const dir = resolve(root, values.eval, set);
    for (const id of (await readdir(dir)).sort()) {
      const file = join(dir, id, 'truth.json');
      if (!existsSync(file)) continue;
      const t = JSON.parse(await readFile(file, 'utf8')) as { id: string; destination: 'CA' | 'US'; documents: Record<string, unknown> };
      const d = t.documents as Record<string, never>;
      out.push({
        shipmentId: `${set}/${t.id}`,
        destination: t.destination,
        ...(d.invoice ? { invoice: { id: 'invoice', data: d.invoice } } : {}),
        ...(d.packingList ? { packingList: { id: 'packing-list', data: d.packingList } } : {}),
        ...(d.billOfLading ? { billOfLading: { id: 'bill-of-lading', data: d.billOfLading } } : {}),
        ...(d.isf ? { isf: { id: 'isf', data: d.isf } } : {}),
      });
    }
  }
  return out;
}

const pct = (n: number, d: number) => (d === 0 ? '—' : `${((100 * n) / d).toFixed(1)}%`);

function markdown(r: EvalReport): string {
  const all = Object.values(r.recall).reduce((a, x) => ({ cases: a.cases + x.cases, flagged: a.flagged + x.flagged, hit: a.hit + x.hit }), { cases: 0, flagged: 0, hit: 0 });
  const strong = STRONG_VARIANTS.map((v) => r.recall[v]).filter(Boolean).reduce((a, x) => ({ cases: a.cases + x.cases, hit: a.hit + x.hit }), { cases: 0, hit: 0 });
  return [
    `# Party screening evaluation (${r.lists.source} lists)`,
    '',
    `${r.shipments} synthetic shipments, ${r.lists.entries} list entries, thresholds: match ${r.thresholds.match}, review ${r.thresholds.review}.`,
    `Each shipment is screened as generated (its parties are invented: any finding is a false positive), with one party replaced by a list entity written one of six ways, and with a buyer renamed to a decoy that shares one word with a list entity.`,
    '',
    '| Metric | Result |',
    '| --- | --- |',
    `| Recall, injected entry flagged (S1 or S2) | ${pct(all.flagged, all.cases)} (${all.flagged}/${all.cases}) |`,
    `| Recall, exact / legal form / alias / word order caught as S1 | ${pct(strong.hit, strong.cases)} (${strong.hit}/${strong.cases}) |`,
    `| Precision, S1 and S2 findings on the injected party (any other party is a false positive) | ${pct(r.precision.correct, r.precision.findings)} (${r.precision.correct}/${r.precision.findings}) |`,
    `| Precision, S1 findings only | ${pct(r.precision.s1Correct, r.precision.s1Findings)} (${r.precision.s1Correct}/${r.precision.s1Findings}) |`,
    '',
    '| Written as | Cases | Flagged | As S1 |',
    '| --- | --- | --- | --- |',
    ...VARIANTS.filter((v) => r.recall[v]).map((v) => `| ${v} | ${r.recall[v].cases} | ${pct(r.recall[v].flagged, r.recall[v].cases)} | ${pct(r.recall[v].hit, r.recall[v].cases)} |`),
    '',
    `False positives: ${r.falsePositives.length}${r.falsePositives.length ? '' : '.'}`,
    ...r.falsePositives.slice(0, 20).map((c) => `- ${c.shipmentId} (${c.kind}${c.written ? `, "${c.written}"` : ''}): ${c.got.map((g) => `${g.ruleId} ${g.list} "${g.name}" ${g.score}`).join('; ')}`),
    '',
    `Misses: ${r.misses.length}${r.misses.length ? '' : '.'}`,
    ...r.misses.slice(0, 20).map((c) => `- ${c.shipmentId} ${c.variant} "${c.written}" for "${c.entry?.name}": ${c.got.length ? c.got.map((g) => `${g.ruleId} "${g.name}" ${g.score}`).join('; ') : 'nothing'}`),
    '',
  ].join('\n');
}

async function main() {
  const loaded = await loadScreening(listsDir);
  if (loaded.index.size === 0) throw new Error(`No lists cached in ${listsDir}: run npm run screening:fetch, or use --lists fixtures`);
  const ships = await shipments();
  // Injected names come from the fixture's entities either way, so both runs inject the same parties.
  const fixture = values.lists === 'fixtures' ? loaded : await loadScreening(resolve(__dirname, '../fixtures'));
  const inject = fixture.index.entries.filter((e) => e.type === 'entity');
  const report = evaluateScreening(ships, loaded.index, {
    thresholds: { ...(values.match ? { match: Number(values.match) } : {}), ...(values.review ? { review: Number(values.review) } : {}) },
    inject: inject.filter((e) => loaded.index.entries.some((x) => x.list === e.list && x.id === e.id)),
    source,
  });
  const out = resolve(root, values.out);
  await mkdir(out, { recursive: true });
  await writeFile(join(out, `screening-${source}.json`), `${JSON.stringify(report, null, 2)}\n`);
  const md = markdown(report);
  await writeFile(join(out, `screening-${source}.md`), md);
  console.log(md);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
