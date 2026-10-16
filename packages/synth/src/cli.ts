import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { buildDataset, V1, V2, V3_DESTINATIONS, type DatasetEntry } from './dataset';
import { htmlToPdf, launchBrowser, renderHtml } from './pdf';
import { buildIsfDataset, renderIsf } from './isf';
import { renderScannedPdf, scanStyle } from './scans';
import { buildDocsDataset } from './documents';
import { combineHtml, invoiceGrid, packingGrid, photoOf, photoStyle } from './inputs';
import { DOCS_FILES, renderDocsHtml } from './render-documents';
import { Rng } from './rng';

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
 * --isf-pdfs writes the ISF filing confirmation (isf.pdf) of every US shipment to data/eval/v1-isf
 *   unless --out is given, with truth.json (all documents, ISF included) and labels.json (v1 labels
 *   plus ISF/invoice mismatches for X11). It never touches data/eval/v1.
 * --docs writes set v1-docs (see documents.ts): 40 v1 shipments with air waybills, certificates of origin,
 *   CUSMA certifications, arrival notices, ISPM 15 and dangerous goods papers, to data/eval/v1-docs
 *   unless --out is given. Only the other documents are printed; invoice, packing list and BL come
 *   from truth.json.
 * --inputs writes set v1-inputs: 20 clean v1 shipments with invoice.xlsx, packing-list.csv, an
 *   invoice photo (invoice.jpg) and every document in one PDF (combined.pdf, its parts in truth.json).
 * --set v2 writes set v2 (new layouts, multi-page line tables, non-English names; see V2 in
 *   dataset.ts) to data/eval/v2 unless --out is given. Seed and sizes come from V2 unless overridden.
 * --set v3-destinations writes shipments to Mexico, the EU and the UK (V3_DESTINATIONS) to
 *   data/eval/v3-destinations, the same way.
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
      'isf-pdfs': { type: 'boolean', default: false },
      set: { type: 'string', default: 'v1' },
      docs: { type: 'boolean', default: false },
      inputs: { type: 'boolean', default: false },
    },
  });
  const presets: Record<string, typeof V1> = { v1: V1, v2: V2, 'v3-destinations': V3_DESTINATIONS };
  const preset = presets[values.set!];
  if (!preset) throw new Error(`Unknown set ${values.set}`);
  if (preset !== V1) {
    // The defaults above are v1's; take the preset's unless they were given on the command line.
    if (values.seed === String(V1.seed)) values.seed = String(preset.seed);
    if (values['per-country'] === String(V1.perCountry)) values['per-country'] = String(preset.perCountry);
    if (values.clean === String(V1.cleanPerCountry)) values.clean = String(preset.cleanPerCountry);
    if (values.out === 'data/eval/v1') values.out = `data/eval/${preset.version}`;
  }
  const scans = values.scans ? Number(values.scans) : 0;
  const isfPdfs = values['isf-pdfs']!;
  const out = resolve(values.out === 'data/eval/v1' ? (scans ? 'data/eval/v1-scans' : isfPdfs ? 'data/eval/v1-isf' : values.out) : values.out!);
  let entries = buildDataset({ ...preset, seed: Number(values.seed), perCountry: Number(values['per-country']), cleanPerCountry: Number(values.clean) });

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

  if (isfPdfs) {
    if (out === resolve('data/eval/v1')) throw new Error('--isf-pdfs must not write into data/eval/v1');
    const isfEntries = buildIsfDataset(entries);
    await rm(out, { recursive: true, force: true });
    const browser = values['no-pdf'] ? undefined : await launchBrowser();
    try {
      for (const e of isfEntries) {
        const dir = join(out, e.shipment.id);
        await mkdir(dir, { recursive: true });
        const { id, seed, destination, render, documents } = e.shipment;
        await writeFile(join(dir, 'truth.json'), JSON.stringify({ id, seed, destination, render, documents }, null, 2) + '\n');
        await writeFile(join(dir, 'labels.json'), JSON.stringify({ id, errors: e.labels }, null, 2) + '\n');
        const html = renderIsf(documents.isf, documents.billOfLading, seed);
        if (values.html) await writeFile(join(dir, 'isf.html'), html);
        if (browser) await writeFile(join(dir, 'isf.pdf'), await htmlToPdf(browser, html));
      }
    } finally {
      await browser?.close();
    }
    const manifest = isfEntries.map((e) => ({ id: e.shipment.id, destination: e.shipment.destination, templates: [e.shipment.render.isfTemplate], errors: e.labels.map((l) => l.kind) }));
    await writeFile(join(out, 'manifest.json'), JSON.stringify({ version: 'v1-isf', seed: Number(values.seed), shipments: manifest }, null, 2) + '\n');
    const isfErrors = isfEntries.filter((e) => e.labels.some((l) => l.document === 'isf')).length;
    console.log(`Wrote ${isfEntries.length} ISF confirmations to ${out} (${isfErrors} disagree with the invoice).`);
    return;
  }

  if (values.docs || values.inputs) {
    const target = values.out === 'data/eval/v1' ? resolve(values.docs ? 'data/eval/v1-docs' : 'data/eval/v1-inputs') : out;
    if (target === resolve('data/eval/v1')) throw new Error('--docs and --inputs must not write into data/eval/v1');
    await rm(target, { recursive: true, force: true });
    const browser = values['no-pdf'] ? undefined : await launchBrowser();
    const manifest: unknown[] = [];
    try {
      if (values.docs) {
        for (const { shipment, labels } of buildDocsDataset(entries)) {
          const dir = join(target, shipment.id);
          await mkdir(dir, { recursive: true });
          const { id, seed, destination, render, documents, attestations, mode } = shipment;
          await writeFile(join(dir, 'truth.json'), JSON.stringify({ id, seed, destination, mode, render, attestations, documents }, null, 2) + '\n');
          await writeFile(join(dir, 'labels.json'), JSON.stringify({ id, errors: labels }, null, 2) + '\n');
          const html = renderDocsHtml(shipment);
          for (const [name, doc] of Object.entries(html)) {
            if (values.html) await writeFile(join(dir, `${name}.html`), doc!);
            if (browser) await writeFile(join(dir, `${name}.pdf`), await htmlToPdf(browser, doc!));
          }
          manifest.push({ id, destination, mode, documents: Object.keys(html).map((n) => DOCS_FILES[n]), errors: labels.map((l) => l.kind) });
        }
      } else {
        const picked = [...entries.filter((e) => e.shipment.destination === 'CA').slice(0, 10), ...entries.filter((e) => e.shipment.destination === 'US').slice(0, 10)];
        const { writeCsv, writeXlsx } = await import('@doccheck/extraction');
        for (const e of picked) {
          const s = e.clean;
          const dir = join(target, s.id);
          await mkdir(dir, { recursive: true });
          const html = renderHtml(s);
          const order = ['invoice', 'packing-list', 'bill-of-lading'] as const;
          const pages: { document: string; pages: number[] }[] = [];
          if (browser) {
            // Page counts of each document printed alone, to know where each starts in the combined PDF.
            const { readPdfText } = await import('@doccheck/extraction');
            let next = 1;
            for (const name of order) {
              const n = (await readPdfText(await htmlToPdf(browser, html[name]), { ocr: 'off' })).pageCount;
              pages.push({ document: name, pages: Array.from({ length: n }, (_, i) => next + i) });
              next += n;
            }
            await writeFile(join(dir, 'combined.pdf'), await htmlToPdf(browser, combineHtml(order.map((n) => html[n]))));
            const shot = await browser.newPage({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 2 });
            await shot.setContent(html.invoice, { waitUntil: 'load' });
            const png = await shot.screenshot({ fullPage: true });
            await shot.close();
            const style = photoStyle(new Rng(s.seed ^ 0x7e1e7e1e));
            await writeFile(join(dir, 'invoice.jpg'), await photoOf(png, style));
            manifest.push({ id: s.id, destination: s.destination, photo: style, combined: pages });
          }
          await writeFile(join(dir, 'invoice.xlsx'), writeXlsx([{ name: 'Invoice', rows: invoiceGrid(s.documents.invoice, s.seed % 2 === 0) }]));
          await writeFile(join(dir, 'packing-list.csv'), writeCsv(packingGrid(s.documents.packingList)));
          const { id, seed, destination, render, documents } = s;
          await writeFile(join(dir, 'truth.json'), JSON.stringify({ id, seed, destination, render, combined: pages, documents }, null, 2) + '\n');
          await writeFile(join(dir, 'labels.json'), JSON.stringify({ id, errors: [] }, null, 2) + '\n');
        }
      }
    } finally {
      await browser?.close();
    }
    await writeFile(join(target, 'manifest.json'), JSON.stringify({ version: values.docs ? 'v1-docs' : 'v1-inputs', seed: Number(values.seed), shipments: manifest }, null, 2) + '\n');
    console.log(`Wrote ${manifest.length} shipments to ${target}.`);
    return;
  }

  if (values['labels-only']) {
    for (const e of entries) await writeFile(join(out, e.shipment.id, 'labels.json'), JSON.stringify({ id: e.shipment.id, errors: e.labels }, null, 2) + '\n');
    await writeManifest(out, Number(values.seed), entries);
    console.log(`Rewrote labels of ${entries.length} shipments in ${out}.`);
    return;
  }

  if (preset !== V1 && out === resolve('data/eval/v1')) throw new Error(`--set ${values.set} must not write into data/eval/v1`);
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

  await writeManifest(out, Number(values.seed), entries, preset.version);

  const faulty = entries.filter((e) => e.labels.length > 0).length;
  const kinds = new Map<string, number>();
  entries.flatMap((e) => e.labels).forEach((l) => kinds.set(l.kind, (kinds.get(l.kind) ?? 0) + 1));
  console.log(`Wrote ${entries.length} shipments to ${out} (${entries.length - faulty} clean, ${faulty} with errors).`);
  console.log([...kinds].sort().map(([k, n]) => `  ${k.padEnd(32)} ${n}`).join('\n'));
}

async function writeManifest(out: string, seed: number, entries: DatasetEntry[], version = 'v1') {
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
  await writeFile(join(out, 'manifest.json'), JSON.stringify({ version, seed, shipments: manifest }, null, 2) + '\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
