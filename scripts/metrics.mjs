// Builds docs/METRICS.md and the metrics block of the README from the evaluation reports:
//   eval/reports/extraction-<model>.json   (npm run eval:extraction)
//   eval/reports/extraction-<model>-v1-scans.json, -v1-isf.json   (same, with --data data/eval/v1-scans or v1-isf)
//   eval/reports/agent-<model>.json        (npm run eval:agent)
// plus the rule engine on the ground-truth documents of data/eval/v1, and on error kinds that v1 does
// not inject (applied one at a time to the clean v1 shipments). Run `npm run build` first.
//
//   node scripts/metrics.mjs [--model ollama_qwen3.8] [--reports eval/reports]
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { runRules } from '@doccheck/rules';
import { buildDataset, buildDocsDataset, docsContext, EXTRA_ERROR_KINDS, injectErrors, Rng } from '@doccheck/synth';

const { values } = parseArgs({ options: { model: { type: 'string', default: 'ollama_qwen3.8' }, reports: { type: 'string', default: 'eval/reports' } } });
const pct = (x) => (x === null || x === undefined ? '—' : `${(x * 100).toFixed(1)}%`);
const readJson = async (f) => (existsSync(f) ? JSON.parse(await readFile(f, 'utf8')) : null);

const extraction = await readJson(join(values.reports, `extraction-${values.model}.json`));
const agent = await readJson(join(values.reports, `agent-${values.model}.json`));
const scans = await readJson(join(values.reports, `extraction-${values.model}-v1-scans.json`));
const isfSet = await readJson(join(values.reports, `extraction-${values.model}-v1-isf.json`));
const v2 = await readJson(join(values.reports, `extraction-${values.model}-v2.json`));
const scansUnlimited = await readJson(join(values.reports, `extraction-${values.model}-v1-scans-unlimited.json`));
const docsSet = await readJson(join(values.reports, `extraction-${values.model}-v1-docs.json`));
const inputs = await readJson(join(values.reports, `inputs-${values.model}.json`));

// Every report records the model build it ran with; numbers from different builds should not be mixed.
const builds = [
  ['extraction v1', extraction],
  ['extraction v1-scans', scans],
  ['extraction v1-isf', isfSet],
  ['extraction v2', v2],
  ['extraction v1-scans (Unlimited-OCR)', scansUnlimited],
  ['extraction v1-docs', docsSet],
  ['inputs v1-inputs', inputs],
  ['agent', agent],
]
  .filter(([, r]) => r)
  .map(([name, r]) => ({ name, build: r.modelVersion ?? 'not recorded' }));
const mixedBuilds = new Set(builds.map((b) => b.build)).size > 1 || builds.some((b) => b.build === 'not recorded');
if (mixedBuilds) console.warn(`Warning: reports come from different or unrecorded model builds: ${builds.map((b) => `${b.name} ${b.build}`).join(', ')}`);

// Rules on ground truth: what the engine catches when extraction is perfect.
const dir = 'data/eval/v1';
const ids = (await readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort();
const perRule = new Map();
let errors = 0;
let covered = 0;
for (const id of ids) {
  const truth = JSON.parse(await readFile(join(dir, id, 'truth.json'), 'utf8'));
  const labels = JSON.parse(await readFile(join(dir, id, 'labels.json'), 'utf8')).errors;
  errors += labels.length;
  covered += labels.filter((l) => l.expectedRuleIds.length > 0).length;
  const d = truth.documents;
  const ctx = {
    shipmentId: id,
    destination: truth.destination,
    invoice: { id: 'invoice', data: d.invoice },
    packingList: { id: 'packingList', data: d.packingList },
    billOfLading: { id: 'billOfLading', data: d.billOfLading },
    isf: d.isf && { id: 'isf', data: d.isf },
  };
  const got = new Set(runRules(ctx).findings.map((f) => f.ruleId));
  const expected = new Set(labels.flatMap((l) => l.expectedRuleIds));
  for (const r of new Set([...got, ...expected])) {
    const row = perRule.get(r) ?? { tp: 0, fp: 0, fn: 0 };
    if (got.has(r) && expected.has(r)) row.tp++;
    else if (got.has(r)) row.fp++;
    else row.fn++;
    perRule.set(r, row);
  }
}
const ruleOrder = (a, b) => a.localeCompare(b, 'en', { numeric: true });
const truthRules = [...perRule].sort(([a], [b]) => ruleOrder(a, b));
const sum = (rows) => rows.reduce((a, [, r]) => ({ tp: a.tp + r.tp, fp: a.fp + r.fp, fn: a.fn + r.fn }), { tp: 0, fp: 0, fn: 0 });
const pr = (r) => ({ recall: r.tp + r.fn ? r.tp / (r.tp + r.fn) : null, precision: r.tp + r.fp ? r.tp / (r.tp + r.fp) : null });
const truthTotal = pr(sum(truthRules));

// Rules on error kinds outside v1 (X9, X12 have no injected errors there): each extra injector alone on
// each clean shipment, same seeds as packages/synth/src/extra-errors.test.ts. Ground truth only.
const toCtx = (s) => ({
  shipmentId: s.id,
  destination: s.destination,
  invoice: { id: 'invoice', data: s.documents.invoice },
  packingList: { id: 'packingList', data: s.documents.packingList },
  billOfLading: { id: 'billOfLading', data: s.documents.billOfLading },
  isf: s.documents.isf && { id: 'isf', data: s.documents.isf },
});
const cleans = buildDataset().map((e) => e.clean);
const extraKinds = EXTRA_ERROR_KINDS.map((kind) => {
  const row = { kind, rules: new Set(), injected: 0, tp: 0, fn: 0, fp: 0 };
  cleans.forEach((clean, i) => {
    const { shipment, labels } = injectErrors(clean, new Rng(0x9e37 + i), 1, [kind]);
    const findings = runRules(toCtx(shipment)).findings;
    for (const label of labels) {
      row.injected++;
      label.expectedRuleIds.forEach((r) => row.rules.add(r));
      const hit = findings
        .filter((f) => label.expectedRuleIds.includes(f.ruleId))
        .some((f) => f.evidence.some((ev) => ev.documentId === label.document && ev.field === label.field));
      if (hit) row.tp++;
      else row.fn++;
      row.fp += findings.filter((f) => !label.expectedRuleIds.includes(f.ruleId)).length;
    }
  });
  return { ...row, ...pr(row) };
});

// Rules T1-T13 on the ground truth of set v1-docs: each shipment's labels against what the engine raises.
const docsTruth = buildDocsDataset(buildDataset());
const docsRules = new Map();
for (const { shipment, labels } of docsTruth) {
  const got = new Set(runRules(docsContext(shipment)).findings.map((f) => f.ruleId));
  const expected = new Set(labels.flatMap((l) => l.expectedRuleIds));
  for (const r of new Set([...got, ...expected])) {
    const row = docsRules.get(r) ?? { tp: 0, fp: 0, fn: 0 };
    if (got.has(r) && expected.has(r)) row.tp++;
    else if (got.has(r)) row.fp++;
    else row.fn++;
    docsRules.set(r, row);
  }
}
const docsTruthRules = [...docsRules].sort(([a], [b]) => ruleOrder(a, b));
const docsTruthTotal = pr(sum(docsTruthRules));
const docsLabels = docsTruth.reduce((n, e) => n + e.labels.length, 0);

const totalOf = (table) => pr(table.reduce((a, r) => ({ tp: a.tp + r.tp, fp: a.fp + r.fp, fn: a.fn + r.fn }), { tp: 0, fp: 0, fn: 0 }));
const extRules = extraction?.rules.table ?? [];
const extTotal = totalOf(extRules);
const scanTotal = scans && totalOf(scans.rules.table);
const isfX11 = isfSet?.rules.table.find((r) => r.rule === 'X11');
const isfType = isfSet?.byType.find((t) => t.type === 'ISF');
const agentRow = (kind) => agent?.summary.find((s) => s.kind === kind);

const headline = [
  '| Stage | Metric | Result |',
  '| --- | --- | --- |',
  extraction ? `| Extraction (${extraction.provider}) | Field accuracy, ${extraction.documents} PDFs | ${pct(extraction.overall.accuracy)} |` : '| Extraction | Field accuracy | not run yet |',
  extraction ? `| Classification | Document type | ${pct(extraction.classificationAccuracy)} |` : null,
  `| Rules on ground truth | Recall / precision on ${covered} covered errors (of ${errors} injected) | ${pct(truthTotal.recall)} / ${pct(truthTotal.precision)} |`,
  extraction ? `| Rules on extracted PDFs | Recall / precision, end to end | ${pct(extTotal.recall)} / ${pct(extTotal.precision)} |` : null,
  scans ? `| Extraction, scanned PDFs (OCR) | Field accuracy, ${scans.documents} PDFs (${scans.validDocuments ?? '?'} complete enough for the rules) | ${pct(scans.overall.accuracy)} |` : null,
  scans ? `| Rules on scanned PDFs | Recall / precision, end to end | ${pct(scanTotal.recall)} / ${pct(scanTotal.precision)} |` : null,
  scansUnlimited ? `| Extraction, scanned PDFs, Unlimited-OCR (Apple Silicon) | Field accuracy, ${scansUnlimited.documents} PDFs (${scansUnlimited.validDocuments} complete enough for the rules) | ${pct(scansUnlimited.overall.accuracy)} |` : null,
  scansUnlimited ? `| Rules on scanned PDFs, Unlimited-OCR | Recall / precision, end to end | ${pct(totalOf(scansUnlimited.rules.table).recall)} / ${pct(totalOf(scansUnlimited.rules.table).precision)} |` : null,
  isfType ? `| Extraction, ISF PDFs | Field accuracy, ${isfSet.documentsDetail.filter((d) => d.type === 'ISF').length} PDFs | ${pct(isfType.accuracy)} |` : null,
  isfX11 ? `| X11 on extracted ISF PDFs | Recall / precision, end to end | ${pct(isfX11.recall)} / ${pct(isfX11.precision)} |` : null,
  v2 ? `| Extraction, unseen formats (v2) | Field accuracy, ${v2.documents} PDFs (${v2.validDocuments ?? '?'} complete enough for the rules) | ${pct(v2.overall.accuracy)} |` : null,
  v2 ? `| Rules on v2 PDFs | Recall / precision, end to end | ${pct(totalOf(v2.rules.table).recall)} / ${pct(totalOf(v2.rules.table).precision)} |` : null,
  `| Rules T1-T13 on ground truth (v1-docs) | Recall / precision on ${docsLabels} injected errors in ${docsTruth.length} shipments | ${pct(docsTruthTotal.recall)} / ${pct(docsTruthTotal.precision)} |`,
  docsSet ? `| Extraction, other documents (v1-docs) | Field accuracy, ${docsSet.documents} PDFs (${docsSet.validDocuments} complete enough for the rules) · classification | ${pct(docsSet.overall.accuracy)} · ${pct(docsSet.classificationAccuracy)} |` : null,
  docsSet ? `| Rules on v1-docs PDFs | Recall / precision, end to end | ${pct(totalOf(docsSet.rules.table).recall)} / ${pct(totalOf(docsSet.rules.table).precision)} |` : null,
  inputs ? `| Spreadsheets (.xlsx invoice, .csv packing list) | Field accuracy, ${inputs.spreadsheets.invoice.documents * 2} sheets, read without a model (${inputs.spreadsheets.headersMappedByModel} headers mapped by it) | ${pct(inputs.spreadsheets.overall.accuracy)} |` : null,
  inputs?.photos ? `| Invoice photos (JPEG, deskew + OCR) | Field accuracy, ${inputs.photos.documents} photos (${inputs.photos.valid} complete enough for the rules) | ${pct(inputs.photos.accuracy)} |` : null,
  inputs ? `| Combined PDFs | Documents split with the right type and pages, ${inputs.combined.documents} documents in ${inputs.combined.files} PDFs | ${pct(inputs.combined.documentAccuracy)} |` : null,
  agentRow('party') ? `| Agent | Same consignee written differently (${agentRow('party').cases} cases): verdict / right action | ${pct(agentRow('party').accuracy)} / ${pct(agentRow('party').effectAccuracy)} (${agentRow('party').wrong} wrong, ${agentRow('party').unsure} unsure) |` : null,
  agentRow('description') ? `| Agent | BL description vs invoice goods (${agentRow('description').cases} cases): verdict / right action | ${pct(agentRow('description').accuracy)} / ${pct(agentRow('description').effectAccuracy)} (${agentRow('description').wrong} wrong, ${agentRow('description').unsure} unsure) |` : null,
].filter(Boolean);

const md = [
  '# Metrics',
  '',
  `Generated by \`scripts/metrics.mjs\` from the evaluation set v1: ${ids.length} synthetic shipments (CA and US), ${errors} injected errors. Models run locally through Ollama.`,
  '',
  ...headline,
  ...(mixedBuilds ? ['', `> Reports from different or unrecorded model builds: ${builds.map((b) => `${b.name} ${b.build}`).join(', ')}. Rerun them on one build before comparing.`] : []),
  '',
  '## Rules',
  '',
  'Ground truth isolates the rules; extracted PDFs measure the whole pipeline (extraction errors become missed or spurious findings).',
  '',
  'Read the ground-truth columns as a consistency check, not as real-world recall: each injected error is labeled with the rule meant to catch it, so 100% means the rules do what they claim on these error types and raise nothing on clean shipments. Errors outside the synthetic generator (and real documents) are not measured here.',
  '',
  '| Rule | Recall (truth) | Precision (truth) | Recall (extracted) | Precision (extracted) |',
  '| --- | --- | --- | --- | --- |',
  ...truthRules.map(([id, r]) => {
    const t = pr(r);
    const e = extRules.find((x) => x.rule === id);
    return `| ${id} | ${pct(t.recall)} | ${pct(t.precision)} | ${pct(e?.recall)} | ${pct(e?.precision)} |`;
  }),
  '',
  '## Rule coverage on injected errors outside v1',
  '',
  `Ground truth only (no extraction, no model). Error kinds that dataset v1 does not inject, applied one at a time to each of its ${cleans.length} clean shipments; v1 itself is unchanged. A hit is the labeled rule citing the altered field; anything else the engine raises counts against precision.`,
  '',
  '| Error kind | Rule | Injected | Caught | Missed | Other findings | Recall (truth) | Precision (truth) |',
  '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ...extraKinds.map((k) => `| \`${k.kind}\` | ${[...k.rules].join(', ')} | ${k.injected} | ${k.tp} | ${k.fn} | ${k.fp} | ${pct(k.recall)} | ${pct(k.precision)} |`),
  '',
  ...(extraction
    ? [
        '## Extraction',
        '',
        `Model build ${extraction.modelVersion ?? 'unknown'} · prompt \`${extraction.promptVersion}\` · ${extraction.shipments} shipments · ${extraction.documents} PDFs · ${extraction.failedDocuments} failed`,
        '',
        '| Document | Accuracy | Fields |',
        '| --- | --- | --- |',
        ...extraction.byType.map((t) => `| ${t.type} | ${pct(t.accuracy)} | ${t.total} |`),
        '',
        '| Template | Accuracy |',
        '| --- | --- |',
        ...extraction.byTemplate.map((t) => `| ${t.template} | ${pct(t.accuracy)} |`),
        '',
        'Weakest fields:',
        '',
        '| Document | Field | Accuracy | Wrong | Missing | Spurious |',
        '| --- | --- | --- | --- | --- | --- |',
        ...extraction.byField.filter((f) => f.accuracy < 1).slice(0, 10).map((f) => `| ${f.type} | \`${f.field}\` | ${pct(f.accuracy)} | ${f.wrong} | ${f.missing} | ${f.spurious} |`),
        '',
      ]
    : []),
  ...(scans
    ? [
        '## Extraction from scans',
        '',
        `Image-only PDFs read with OCR (English and French models), same shipments and labels as v1. Model build ${scans.modelVersion ?? 'unknown'} · prompt \`${scans.promptVersion}\` · ${scans.shipments} shipments · ${scans.documents} PDFs · ${scans.failedDocuments} failed · classification ${pct(scans.classificationAccuracy)}`,
        '',
        '| Document | Accuracy (scan) | Accuracy (text layer) | Fields |',
        '| --- | --- | --- | --- |',
        ...scans.byType.map((t) => `| ${t.type} | ${pct(t.accuracy)} | ${pct(extraction?.byType.find((x) => x.type === t.type)?.accuracy)} | ${t.total} |`),
        '',
        '| Rule | Recall (scan) | Precision (scan) |',
        '| --- | --- | --- |',
        ...[...scans.rules.table].sort((a, b) => ruleOrder(a.rule, b.rule)).map((r) => `| ${r.rule} | ${pct(r.recall)} | ${pct(r.precision)} |`),
        '',
      ]
    : []),
  ...(isfSet
    ? [
        '## ISF filing confirmations',
        '',
        `The ${isfSet.shipments} US shipments with the ISF as a PDF${isfX11 ? `; ${isfX11.tp + isfX11.fn} of them disagree with the invoice (origin, HTS or seller) and are labeled for X11` : ''}. Model build ${isfSet.modelVersion ?? 'unknown'} · prompt \`${isfSet.promptVersion}\` · ${isfSet.documents} PDFs · ${isfSet.failedDocuments} failed · classification ${pct(isfSet.classificationAccuracy)}`,
        '',
        '| Document | Accuracy | Fields |',
        '| --- | --- | --- |',
        ...isfSet.byType.map((t) => `| ${t.type} | ${pct(t.accuracy)} | ${t.total} |`),
        '',
        ...(isfX11 ? [`X11 end to end: ${isfX11.tp} caught, ${isfX11.fn} missed, ${isfX11.fp} raised on shipments without an ISF error (recall ${pct(isfX11.recall)}, precision ${pct(isfX11.precision)}).`, ''] : []),
        ...(isfSet.byField.filter((f) => f.type === 'ISF' && f.accuracy < 1).length
          ? [
              'Weakest ISF fields:',
              '',
              '| Field | Accuracy | Wrong | Missing | Spurious |',
              '| --- | --- | --- | --- | --- |',
              ...isfSet.byField.filter((f) => f.type === 'ISF' && f.accuracy < 1).slice(0, 10).map((f) => `| \`${f.field}\` | ${pct(f.accuracy)} | ${f.wrong} | ${f.missing} | ${f.spurious} |`),
              '',
            ]
          : []),
      ]
    : []),
  ...(v2
    ? [
        '## Unseen formats (set v2)',
        '',
        `Layouts, number and date formats the prompt was not tuned on: a European letterhead layout ("48.600,00", "1 140,50 kg", "14.03.2026") and a numbered-box form, line tables of up to 40 rows that run onto a second page, and parties with accented, non-English names. The three v1 layouts stay in the mix as a control. Model build ${v2.modelVersion ?? 'unknown'} · prompt \`${v2.promptVersion}\` · ${v2.shipments} shipments · ${v2.documents} PDFs · ${v2.failedDocuments} failed · classification ${pct(v2.classificationAccuracy)}`,
        '',
        '| Document | v2 overall | v2 new layouts | v2 v1 layouts | v1 set |',
        '| --- | --- | --- | --- | --- |',
        ...v2.byType.map((t) => {
          const of = (re) => {
            const rows = v2.byTemplate.filter((x) => x.template.startsWith(`${t.type} · `) && re.test(x.template));
            const total = rows.reduce((a, r) => a + r.total, 0);
            return total ? rows.reduce((a, r) => a + r.correct, 0) / total : null;
          };
          return `| ${t.type} | ${pct(t.accuracy)} | ${pct(of(/· (euro|grid)$/))} | ${pct(of(/· (classic|modern|legacy)$/))} | ${pct(extraction?.byType.find((x) => x.type === t.type)?.accuracy)} |`;
        }),
        '',
        '| Rule | Recall (v2) | Precision (v2) |',
        '| --- | --- | --- |',
        ...[...v2.rules.table].sort((a, b) => ruleOrder(a.rule, b.rule)).map((r) => `| ${r.rule} | ${pct(r.recall)} | ${pct(r.precision)} |`),
        '',
        'Weakest fields:',
        '',
        '| Document | Field | Accuracy | Wrong | Missing | Spurious |',
        '| --- | --- | --- | --- | --- | --- |',
        ...v2.byField.filter((f) => f.accuracy < 1).slice(0, 10).map((f) => `| ${f.type} | \`${f.field}\` | ${pct(f.accuracy)} | ${f.wrong} | ${f.missing} | ${f.spurious} |`),
        '',
      ]
    : []),
  '## Other documents (set v1-docs)',
  '',
  `${docsTruth.length} v1 shipments with the other documents a shipment carries: air waybills instead of bills of lading, chamber certificates of origin, CUSMA certifications, arrival notices, ISPM 15 heat-treatment certificates and dangerous goods declarations (\`npm run synth -- --docs\`); ${docsLabels} injected errors, each labelled with the T rule that must flag it.`,
  '',
  '| Rule | Recall (truth) | Precision (truth) | Recall (extracted) | Precision (extracted) |',
  '| --- | --- | --- | --- | --- |',
  ...docsTruthRules.map(([id, r]) => {
    const t = pr(r);
    const e = docsSet?.rules.table.find((x) => x.rule === id);
    return `| ${id} | ${pct(t.recall)} | ${pct(t.precision)} | ${pct(e?.recall)} | ${pct(e?.precision)} |`;
  }),
  '',
  ...(docsSet
    ? [
        `Model build ${docsSet.modelVersion ?? 'unknown'} · prompt \`${docsSet.promptVersion}\` · ${docsSet.documents} PDFs · ${docsSet.failedDocuments} failed · classification ${pct(docsSet.classificationAccuracy)}`,
        '',
        '| Document | Accuracy | Fields | Valid documents |',
        '| --- | --- | --- | --- |',
        ...docsSet.byType.map((t) => `| ${t.type} | ${pct(t.accuracy)} | ${t.total} | ${t.validDocuments}/${t.documents} |`),
        '',
        'Weakest fields:',
        '',
        '| Document | Field | Accuracy | Wrong | Missing | Spurious |',
        '| --- | --- | --- | --- | --- | --- |',
        ...docsSet.byField.filter((f) => f.accuracy < 1).slice(0, 10).map((f) => `| ${f.type} | \`${f.field}\` | ${pct(f.accuracy)} | ${f.wrong} | ${f.missing} | ${f.spurious} |`),
        '',
      ]
    : []),
  ...(inputs
    ? [
        '## Input formats (set v1-inputs)',
        '',
        `${inputs.shipments} clean v1 shipments (\`npm run synth -- --inputs\`): the invoice as an .xlsx (half with headers the vocabulary does not know, mapped by the model from the header texts alone) and the packing list as a .csv, the invoice as a phone photo, and the invoice, packing list and BL in one PDF. The shipments are clean, so every finding on what was read is a false positive. Report \`eval/reports/inputs-${values.model}.md\`.`,
        '',
        '| Input | Documents | Field accuracy | Valid documents | Findings on clean shipments |',
        '| --- | --- | --- | --- | --- |',
        `| Invoice .xlsx | ${inputs.spreadsheets.invoice.documents} | ${pct(inputs.spreadsheets.invoice.accuracy)} | ${inputs.spreadsheets.invoice.valid} | ${inputs.spreadsheets.findingsOnCleanShipments} (with the .csv packing list) |`,
        `| Packing list .csv | ${inputs.spreadsheets.packingList.documents} | ${pct(inputs.spreadsheets.packingList.accuracy)} | ${inputs.spreadsheets.packingList.valid} | |`,
        ...(inputs.photos ? [`| Invoice photo | ${inputs.photos.documents} | ${pct(inputs.photos.accuracy)} | ${inputs.photos.valid} | ${inputs.photos.findings} |`] : []),
        '',
        `Combined PDFs: ${inputs.combined.exact} of ${inputs.combined.documents} documents split with the right type and pages; ${inputs.combined.pagesRight} of ${inputs.combined.pages} pages in the right document.${inputs.photos ? ` Photo deskew: mean error ${inputs.photos.meanAngleError.toFixed(2)}° from the rotation drawn.` : ''}`,
        '',
      ]
    : []),
  ...(agent
    ? [
        '## Agent',
        '',
        `Model build ${agent.modelVersion ?? 'unknown'} · prompt \`${agent.promptVersion}\` · acts only at confidence ≥ 0.7; "unsure" never dismisses a finding.`,
        '',
        '| Decision | Cases | Verdict accuracy | When answered | Wrong | Unsure | Right action |',
        '| --- | --- | --- | --- | --- | --- | --- |',
        ...agent.summary.map((s) => `| ${s.kind === 'party' ? 'Same consignee? (X1)' : 'BL description consistent? (A1)'} | ${s.cases} | ${pct(s.accuracy)} | ${pct(s.accuracyWhenAnswered)} | ${s.wrong} | ${s.unsure} | ${pct(s.effectAccuracy)} |`),
        '',
      ]
    : []),
].join('\n');

await writeFile('docs/METRICS.md', md);
const readme = await readFile('README.md', 'utf8');
const block = `<!-- metrics:start -->\n${headline.join('\n')}\n\nDetails in [docs/METRICS.md](docs/METRICS.md); design and lessons in [docs/WRITEUP.md](docs/WRITEUP.md).\n<!-- metrics:end -->`;
await writeFile('README.md', readme.replace(/<!-- metrics:start -->[\s\S]*<!-- metrics:end -->/, block));
console.log(md);
