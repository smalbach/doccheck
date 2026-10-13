import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { buildDataset, V1, type DatasetEntry } from './dataset';
import { htmlToPdf, launchBrowser, renderHtml } from './pdf';
import { renderScannedPdf, scanStyle } from './scans';

/**
 * Writes the evaluation set:
 *   <out>/manifest.json               one row per shipment: destination, templates, error kinds
 *   <out>/<id>/truth.json             documents as printed (errors included) + render options
 *   <out>/<id>/labels.json            injected errors with expected rule ids
 *   <out>/<id>/*.pdf | *.html         invoice, packing list, bill of lading
 *
 * Usage: node dist/cli.js [--out data/eval/v1] [--seed N] [--per-country 100] [--clean 25] [--no-pdf] [--html] [--labels-only]
 * --labels-only rewrites labels.json and manifest.json in place, e.g. after rules start covering an error kind.
 * --scans N writes N shipments (half CA, half US) as image-only PDFs that look scanned, to
 *   data/eval/v1-scans unless --out is given. Same truth and labels as the v1 shipments.
 */
async function main() {
  const { values } = parseArgs({
    options: {
      out: { type: 'string', default: 'data/eval/v1' },
      seed: { type: 'string', default: String(V1.seed) },
      'per-country': { type: 'string', default: String(V1.perCountry) },
      clean: { type: 'string', default: String(V1.cleanPerCountry) },
      'no-pdf': { type: 'boolean', default: false },
      html: { type: 'boolean', default: false },
      'labels-only': { type: 'boolean', default: false },
      scans: { type: 'string' },
    },
  });
  const scans = values.scans ? Number(values.scans) : 0;
  const out = resolve(scans && values.out === 'data/eval/v1' ? 'data/eval/v1-scans' : values.out!);
  let entries = buildDataset({ seed: Number(values.seed), perCountry: Number(values['per-country']), cleanPerCountry: Number(values.clean) });

  if (scans) {
    entries = [...entries.filter((e) => e.shipment.destination === 'CA').slice(0, Math.ceil(scans / 2)), ...entries.filter((e) => e.shipment.destination === 'US').slice(0, Math.floor(scans / 2))];
    await rm(out, { recursive: true, force: true });
    const browser = await launchBrowser();
    try {
      for (const e of entries) {
        const dir = join(out, e.shipment.id);
        await mkdir(dir, { recursive: true });
        const style = scanStyle(e.shipment.seed);
        const { id, seed, destination, render, documents } = e.shipment;
        await writeFile(join(dir, 'truth.json'), JSON.stringify({ id, seed, destination, render: { ...render, scan: style }, documents }, null, 2) + '\n');
        await writeFile(join(dir, 'labels.json'), JSON.stringify({ id, errors: e.labels }, null, 2) + '\n');
        for (const [name, html] of Object.entries(renderHtml(e.shipment))) await writeFile(join(dir, `${name}.pdf`), await renderScannedPdf(browser, html, style));
      }
    } finally {
      await browser.close();
    }
    await writeManifest(out, Number(values.seed), entries);
    console.log(`Wrote ${entries.length} scanned shipments to ${out}.`);
    return;
  }

  if (values['labels-only']) {
    for (const e of entries) await writeFile(join(out, e.shipment.id, 'labels.json'), JSON.stringify({ id: e.shipment.id, errors: e.labels }, null, 2) + '\n');
    await writeManifest(out, Number(values.seed), entries);
    console.log(`Rewrote labels of ${entries.length} shipments in ${out}.`);
    return;
  }

  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  const browser = values['no-pdf'] ? undefined : await launchBrowser();

  try {
    const queue = [...entries];
    const worker = async () => {
      for (let e = queue.shift(); e; e = queue.shift()) {
        const dir = join(out, e.shipment.id);
        await mkdir(dir, { recursive: true });
        const { id, seed, destination, render, documents } = e.shipment;
        await writeFile(join(dir, 'truth.json'), JSON.stringify({ id, seed, destination, render, documents }, null, 2) + '\n');
        await writeFile(join(dir, 'labels.json'), JSON.stringify({ id, errors: e.labels }, null, 2) + '\n');
        for (const [name, html] of Object.entries(renderHtml(e.shipment))) {
          if (values.html) await writeFile(join(dir, `${name}.html`), html);
          if (browser) await writeFile(join(dir, `${name}.pdf`), await htmlToPdf(browser, html));
        }
      }
    };
    await Promise.all(Array.from({ length: browser ? 6 : 1 }, worker));
  } finally {
    await browser?.close();
  }

  await writeManifest(out, Number(values.seed), entries);

  const faulty = entries.filter((e) => e.labels.length > 0).length;
  const kinds = new Map<string, number>();
  entries.flatMap((e) => e.labels).forEach((l) => kinds.set(l.kind, (kinds.get(l.kind) ?? 0) + 1));
  console.log(`Wrote ${entries.length} shipments to ${out} (${entries.length - faulty} clean, ${faulty} with errors).`);
  console.log([...kinds].sort().map(([k, n]) => `  ${k.padEnd(32)} ${n}`).join('\n'));
}

async function writeManifest(out: string, seed: number, entries: DatasetEntry[]) {
  const manifest = entries.map((e) => ({
    id: e.shipment.id,
    destination: e.shipment.destination,
    templates: [e.shipment.render.invoiceTemplate, e.shipment.render.packingListTemplate, e.shipment.render.blTemplate],
    blWeightUnit: e.shipment.render.blWeightUnit,
    bilingual: e.shipment.render.bilingual,
    lines: e.shipment.documents.invoice.lines.length,
    containers: e.shipment.documents.billOfLading.containers.length,
    errors: e.labels.map((l) => l.kind),
  }));
  await writeFile(join(out, 'manifest.json'), JSON.stringify({ version: 'v1', seed, shipments: manifest }, null, 2) + '\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
