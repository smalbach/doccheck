#!/usr/bin/env node
/**
 * A "supplier quirk" evaluation set for supplier learning (docs/REVIEW.md): one supplier whose invoices
 * and packing lists print the net and gross weights under each other's label. A model that copies
 * values as printed reads them swapped on every document from that supplier, until it is shown the
 * corrections.
 *
 * Takes shipments of an existing set (their ground truth), gives every one the same seller, renders
 * the invoice and packing list with the weights swapped (the truth keeps them right) and the bill of
 * lading as it is. Writes <out>/<id>/{truth.json,labels.json,*.pdf}.
 *
 *   npm run build -w @doccheck/synth
 *   node scripts/supplier-quirk-set.mjs [--from data/eval/v1] [--out data/eval/supplier-quirk] [--count 12]
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { htmlToPdf, launchBrowser, renderHtml } from '@doccheck/synth';

const { values } = parseArgs({ options: { from: { type: 'string', default: 'data/eval/v1' }, out: { type: 'string', default: 'data/eval/supplier-quirk' }, count: { type: 'string', default: '12' } } });
const from = resolve(values.from);
const out = resolve(values.out);
const count = Number(values.count);

const SUPPLIER = {
  name: 'Norland Precision Scales Co., Ltd.',
  address: { lines: ['88 Gaoxin Road, Building 3'], city: 'Ningbo', region: 'Zhejiang', postalCode: '315040', country: 'CN' },
  taxId: '91330200MA2H7K4X1Q',
};

const swap = (o) => (o ? { ...o, netWeight: o.grossWeight, grossWeight: o.netWeight } : o);

// Every template appears: the quirk must be learned from the field, not from one layout.
const ids = (await readdir(from, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort();
const picked = [];
const seen = new Set();
for (const id of ids) {
  if (picked.length >= count) break;
  const truth = JSON.parse(await readFile(join(from, id, 'truth.json'), 'utf8'));
  const key = `${truth.render.invoiceTemplate}/${truth.render.packingListTemplate}`;
  if (seen.has(key) && seen.size < 9) continue;
  seen.add(key);
  picked.push(truth);
}

const browser = await launchBrowser();
try {
  for (const [i, truth] of picked.entries()) {
    const id = `QK-${String(i + 1).padStart(3, '0')}`;
    const docs = truth.documents;
    docs.invoice.seller = { ...docs.invoice.seller, ...SUPPLIER };
    if (docs.packingList.seller) docs.packingList.seller = { ...docs.packingList.seller, ...SUPPLIER };
    docs.billOfLading.shipper = { ...docs.billOfLading.shipper, ...SUPPLIER };
    // As printed: the weights under each other's label (header, totals and every package row).
    const printed = {
      ...truth,
      documents: {
        ...docs,
        invoice: swap(docs.invoice),
        packingList: { ...docs.packingList, totals: swap(docs.packingList.totals), packages: docs.packingList.packages.map(swap) },
      },
    };
    const html = renderHtml(printed);
    const dir = join(out, id);
    await mkdir(dir, { recursive: true });
    for (const [name, page] of Object.entries(html)) await writeFile(join(dir, `${name}.pdf`), await htmlToPdf(browser, page));
    await writeFile(join(dir, 'truth.json'), JSON.stringify({ ...truth, id, source: truth.id, quirk: 'net-gross-swapped' }, null, 2) + '\n');
    await writeFile(join(dir, 'labels.json'), JSON.stringify({ errors: [] }, null, 2) + '\n');
    console.log(`${id} from ${truth.id} (${truth.render.invoiceTemplate} invoice, ${truth.render.packingListTemplate} packing list)`);
  }
} finally {
  await browser.close();
}
