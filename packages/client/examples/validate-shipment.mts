/**
 * Creates a shipment, uploads its PDFs, validates it and prints the findings, then saves the
 * CargoWise XML. Run from the repository root after `npm run build -w @doccheck/client`:
 *
 *   DOCCHECK_URL=http://localhost:3000 DOCCHECK_API_KEY=dck_... \
 *     node --experimental-strip-types packages/client/examples/validate-shipment.mts PO-4411 CA invoice.pdf packing-list.pdf bill-of-lading.pdf
 */
import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { DocCheckApiError, DocCheckClient, type Destination } from '../dist/index.js';

const [reference, destination, ...paths] = process.argv.slice(2);
if (!reference || (destination !== 'CA' && destination !== 'US') || !paths.length) {
  console.error('Usage: validate-shipment.mts <reference> <CA|US> <pdf>...');
  process.exit(1);
}

const dc = new DocCheckClient({ baseUrl: process.env.DOCCHECK_URL ?? 'http://localhost:3000', apiKey: process.env.DOCCHECK_API_KEY ?? '' });

try {
  // The reference as idempotency key: running the script twice does not make two shipments.
  const shipment = await dc.createShipment({ reference, destination: destination as Destination }, { idempotencyKey: `create-${reference}` });
  console.log(`Shipment ${shipment.id} (${reference})`);
  const files = await Promise.all(paths.map(async (p) => ({ name: basename(p), data: await readFile(p) })));
  await dc.uploadDocuments(shipment.id, files, { idempotencyKey: `upload-${reference}` });
  const read = await dc.waitForExtraction(shipment.id);
  for (const d of read.documents) console.log(`  ${d.fileName}: ${d.detectedType} ${d.status}${d.error ? ` (${d.error})` : ''}`);

  const validation = await dc.validate(shipment.id, { wait: true });
  console.log(`\n${validation.findings.length} finding(s)`);
  for (const f of validation.findings) {
    console.log(`  [${f.severity}] ${f.ruleId} ${f.message}`);
    for (const e of f.evidence) console.log(`      ${e.field} = ${e.value}${e.source ? ` (page ${e.source.page})` : ''}`);
    if (f.regulation) console.log(`      ${f.regulation.title} ${f.regulation.url}`);
  }

  const xml = await dc.exportShipment(shipment.id, 'cargowise-xml');
  await writeFile(`${reference}.cargowise.xml`, xml);
  console.log(`\nSaved ${reference}.cargowise.xml`);
} catch (err) {
  if (err instanceof DocCheckApiError) console.error(`DocCheck answered ${err.status}: ${err.message}`);
  else throw err;
  process.exit(1);
}
