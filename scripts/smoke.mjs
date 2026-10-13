// Starts the built API, creates a shipment, validates the sample documents with one injected error,
// and prints the findings. Run `npm run build` first.
import { spawn } from 'node:child_process';
import { sampleBillOfLading, sampleInvoice, samplePackingList } from '@doccheck/schemas';

const port = 3999;
const api = spawn('node', ['apps/api/dist/main.js'], { env: { ...process.env, PORT: String(port) }, stdio: 'inherit' });
const base = `http://localhost:${port}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(`${base}/health`)).ok) break; } catch {}
    await wait(250);
  }
  const shipment = await (await fetch(`${base}/shipments`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reference: 'SMOKE-1', destination: 'CA', transportMode: 'SEA' }),
  })).json();

  const bl = structuredClone(sampleBillOfLading);
  bl.totalPackages = 121; // injected error -> X2
  const res = await fetch(`${base}/shipments/${shipment.id}/validate?agent=false`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ invoice: sampleInvoice, packingList: samplePackingList, billOfLading: bl }),
  });
  const out = await res.json();
  console.log(JSON.stringify(out, null, 2));
  if (!out.findings?.some((f) => f.ruleId === 'X2')) throw new Error('Expected an X2 finding');
  console.log('\nSmoke test passed.');
} finally {
  api.kill();
}
