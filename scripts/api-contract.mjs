#!/usr/bin/env node
/**
 * The public API's OpenAPI document and Postman collection, and a contract test that runs the
 * collection against a server with the Postman CLI.
 *
 *   npm run build -w @doccheck/integrations -w @doccheck/api
 *   node scripts/api-contract.mjs --write-only       # docs/api/openapi.json + the Postman collection
 *   node scripts/api-contract.mjs [--url http://localhost:3000] [--pdf-dir data/eval/v1/CA-001]
 *
 * The run signs up a throwaway account on the server, makes an API key, and runs the collection
 * (postman collection run, with --no-report-events: nothing goes to Postman's cloud). Every answer is
 * checked against the response schema the OpenAPI document gives for its status. The PDFs uploaded
 * are a sample shipment (npm run synth); with LLM_CACHE_MODE=replay on the server no model is needed.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const root = resolve(import.meta.dirname, '..');
const { values } = parseArgs({
  options: {
    url: { type: 'string', default: process.env.APP_URL ?? 'http://localhost:3000' },
    'pdf-dir': { type: 'string', default: 'data/eval/v1/CA-001' },
    'write-only': { type: 'boolean', default: false },
  },
});
const require = createRequire(import.meta.url);
require(join(root, 'node_modules/reflect-metadata'));
const { openApiDocument } = require(join(root, 'apps/api/dist/integrations/v1/openapi.js'));

const spec = openApiDocument('http://localhost:3000');
const outDir = join(root, 'docs/api');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'openapi.json'), JSON.stringify(spec, null, 2) + '\n');

/** Component schemas as draft-07 definitions, which the Postman sandbox's validator reads. */
function definitions() {
  const convert = (node) => {
    if (Array.isArray(node)) return node.map(convert);
    if (!node || typeof node !== 'object') return node;
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === 'format' || k === 'contentMediaType' || k === '$schema' || k === 'id') continue;
      if (k === '$ref' && typeof v === 'string') out.$ref = v.replace('#/components/schemas/', '#/definitions/');
      // A 2020-12 tuple (prefixItems, items: false) is items: [...], additionalItems: false in draft-07.
      else if (k === 'prefixItems') Object.assign(out, { items: convert(v), additionalItems: node.items ?? true });
      else if (k === 'items' && 'prefixItems' in node) continue;
      else out[k] = k === 'properties' ? Object.fromEntries(Object.entries(v).map(([p, s]) => [p, convert(s)])) : convert(v);
    }
    return out;
  };
  return convert(spec.components.schemas);
}

const pdfDir = values['pdf-dir'];
const json = (body) => ({ mode: 'raw', raw: JSON.stringify(body, null, 2), options: { raw: { language: 'json' } } });
const auth = { type: 'bearer', bearer: [{ key: 'token', value: '{{apiKey}}', type: 'string' }] };
const url = (path, query = []) => ({ raw: `{{baseUrl}}${path}${query.length ? `?${query.map((q) => `${q.key}=${q.value}`).join('&')}` : ''}`, host: ['{{baseUrl}}'], path: path.split('/').filter(Boolean), ...(query.length ? { query } : {}) });

/** Status check plus the schema of that status in the OpenAPI document. */
const expect = (status, schemaId, extra = []) => [
  `pm.test('status ${status}', () => pm.response.to.have.status(${status}));`,
  ...(schemaId
    ? [`pm.test('matches ${schemaId}', () => pm.response.to.have.jsonSchema({ $ref: '#/definitions/${schemaId}', definitions: JSON.parse(pm.collectionVariables.get('schemas')) }));`]
    : []),
  ...extra,
];
const item = (name, request, tests, prerequest) => ({
  name,
  event: [{ listen: 'test', script: { type: 'text/javascript', exec: tests } }, ...(prerequest ? [{ listen: 'prerequest', script: { type: 'text/javascript', exec: prerequest } }] : [])],
  request,
});
/** Waits (in the pre-request script) until no document of the shipment is still being read. */
const waitForExtraction = [
  'const deadline = Date.now() + 120000;',
  'const poll = () => pm.sendRequest({ url: `${pm.variables.get("baseUrl")}/api/v1/shipments/${pm.variables.get("shipmentId")}`, header: { authorization: `Bearer ${pm.variables.get("apiKey")}` } }, (err, res) => {',
  '  const busy = !err && res.json().documents.some((d) => d.status === "QUEUED" || d.status === "EXTRACTING");',
  '  if (busy && Date.now() < deadline) setTimeout(poll, 1000);',
  '});',
  'poll();',
];

const collection = {
  info: {
    _postman_id: '6f2a3b0e-5d1c-4b8e-9a77-0c4d5e6f7a81',
    name: 'DocCheck API v1',
    description: `Generated from docs/api/openapi.json by scripts/api-contract.mjs; do not edit by hand. Set baseUrl and apiKey (an API key from Integrations → API keys). The requests run in order as a contract test: each answer is checked against the OpenAPI response schema. The upload sends the PDFs in ${pdfDir} (relative to the working directory; npm run synth makes them).`,
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  auth,
  variable: [
    { key: 'baseUrl', value: 'http://localhost:3000' },
    { key: 'apiKey', value: '' },
    { key: 'schemas', value: JSON.stringify(definitions()) },
  ],
  item: [
    item('OpenAPI document', { method: 'GET', auth: { type: 'noauth' }, url: url('/api/v1/openapi.json') }, expect(200, null, [`pm.test('is OpenAPI 3.1', () => pm.expect(pm.response.json().openapi).to.eql('3.1.0'));`])),
    item('No key: 401', { method: 'GET', auth: { type: 'noauth' }, url: url('/api/v1/shipments') }, expect(401, 'Error')),
    item('List shipments', { method: 'GET', url: url('/api/v1/shipments', [{ key: 'limit', value: '5' }]) }, expect(200, 'ShipmentList', [
      `pm.test('rate limit headers', () => { pm.response.to.have.header('RateLimit-Limit'); pm.response.to.have.header('RateLimit-Remaining'); });`,
    ])),
    item(
      'Create shipment',
      { method: 'POST', header: [{ key: 'Idempotency-Key', value: '{{createKey}}' }], body: json({ reference: 'POSTMAN-{{$timestamp}}', destination: 'CA', transportMode: 'SEA' }), url: url('/api/v1/shipments') },
      expect(201, 'Shipment', [`pm.collectionVariables.set('shipmentId', pm.response.json().id);`, `pm.collectionVariables.set('createBody', pm.request.body.raw);`]),
      [`pm.collectionVariables.set('createKey', pm.variables.replaceIn('{{$guid}}'));`],
    ),
    item(
      'Create shipment again (idempotent replay)',
      { method: 'POST', header: [{ key: 'Idempotency-Key', value: '{{createKey}}' }], body: { mode: 'raw', raw: '{{createBody}}', options: { raw: { language: 'json' } } }, url: url('/api/v1/shipments') },
      expect(201, 'Shipment', [
        `pm.test('replayed', () => pm.response.to.have.header('Idempotent-Replayed', 'true'));`,
        `pm.test('same shipment', () => pm.expect(pm.response.json().id).to.eql(pm.collectionVariables.get('shipmentId')));`,
      ]),
    ),
    item('Same idempotency key, other request: 422', { method: 'POST', header: [{ key: 'Idempotency-Key', value: '{{createKey}}' }], body: json({ reference: 'OTHER' }), url: url('/api/v1/shipments') }, expect(422, 'Error')),
    item('Invalid body: 400', { method: 'POST', body: json({ destination: 'MX' }), url: url('/api/v1/shipments') }, expect(400, 'Error')),
    item('Get shipment', { method: 'GET', url: url('/api/v1/shipments/{{shipmentId}}') }, expect(200, 'Shipment')),
    item('Unknown shipment: 404', { method: 'GET', url: url(`/api/v1/shipments/${randomUUID()}`) }, expect(404, 'Error')),
    item(
      'Upload documents',
      {
        method: 'POST',
        header: [{ key: 'Idempotency-Key', value: '{{$guid}}' }],
        body: { mode: 'formdata', formdata: ['invoice.pdf', 'packing-list.pdf', 'bill-of-lading.pdf'].map((f) => ({ key: 'files', type: 'file', src: `${pdfDir}/${f}` })) },
        url: url('/api/v1/shipments/{{shipmentId}}/documents'),
      },
      expect(202, 'UploadResult', [`pm.collectionVariables.set('documentId', pm.response.json().documents[0].id);`]),
    ),
    item('Findings before validation: 404', { method: 'GET', url: url('/api/v1/shipments/{{shipmentId}}/findings') }, expect(404, 'Error')),
    item(
      'Validate and wait',
      { method: 'POST', url: url('/api/v1/shipments/{{shipmentId}}/validate', [{ key: 'agent', value: 'false' }, { key: 'wait', value: 'true' }]) },
      expect(200, 'Validation'),
      waitForExtraction,
    ),
    item('Get document with extracted data', { method: 'GET', url: url('/api/v1/shipments/{{shipmentId}}/documents/{{documentId}}') }, expect(200, 'DocumentDetail', [`pm.test('extracted', () => pm.expect(pm.response.json().document.status).to.eql('EXTRACTED'));`])),
    item('Validate in the background', { method: 'POST', url: url('/api/v1/shipments/{{shipmentId}}/validate', [{ key: 'agent', value: 'false' }]) }, expect(202, 'ValidationQueued')),
    item('Findings', { method: 'GET', url: url('/api/v1/shipments/{{shipmentId}}/findings') }, expect(200, 'Validation'), ['setTimeout(() => {}, 1500);']),
    item('Export CargoWise XML', { method: 'GET', url: url('/api/v1/shipments/{{shipmentId}}/exports/cargowise-xml') }, expect(200, null, [`pm.test('Universal Shipment', () => pm.expect(pm.response.text()).to.include('<UniversalShipment'));`])),
    item('Export X12 856', { method: 'GET', url: url('/api/v1/shipments/{{shipmentId}}/exports/x12-856') }, expect(200, null, [`pm.test('X12 envelope', () => pm.expect(pm.response.text()).to.match(/^ISA\\*/));`])),
    item('Unknown export format: 400', { method: 'GET', url: url('/api/v1/shipments/{{shipmentId}}/exports/pdf') }, expect(400, 'Error')),
    item('Send export to the mock connector', { method: 'POST', body: json({ connector: 'mock' }), url: url('/api/v1/shipments/{{shipmentId}}/exports/x12-310/send') }, expect(200, 'SendResult')),
  ],
};
const collectionPath = join(outDir, 'doccheck.postman_collection.json');
writeFileSync(collectionPath, JSON.stringify(collection, null, 2) + '\n');
console.log(`Wrote ${relative(root, join(outDir, 'openapi.json'))} and ${relative(root, collectionPath)}`);
if (values['write-only']) process.exit(0);

// The run: a throwaway account and key on the server, then the Postman CLI.
const base = values.url.replace(/\/$/, '');
if (!existsSync(resolve(root, pdfDir, 'invoice.pdf'))) throw new Error(`No sample PDFs in ${pdfDir}: run npm run synth, or pass --pdf-dir`);
const register = await fetch(`${base}/auth/register`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: `contract-${Date.now()}@doccheck.invalid`, password: `contract-${randomUUID()}`, name: 'API contract test' }),
});
if (!register.ok) throw new Error(`Sign-up failed: ${register.status} ${await register.text()}`);
const cookie = register.headers.getSetCookie().find((c) => c.startsWith('doccheck_session='))?.split(';')[0];
const key = await fetch(`${base}/integrations/api-keys`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ name: 'Postman contract test', scopes: ['read', 'write'] }) });
if (!key.ok) throw new Error(`API key failed: ${key.status} ${await key.text()}`);
const { key: apiKey } = await key.json();
execFileSync('postman', ['collection', 'run', collectionPath, '--env-var', `baseUrl=${base}`, '--env-var', `apiKey=${apiKey}`, '--working-dir', root, '--no-report-events', '--timeout-request', '180000'], { stdio: 'inherit', cwd: root });
