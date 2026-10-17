/**
 * A webhook receiver: checks each delivery's signature and prints the event.
 *
 *   DOCCHECK_WEBHOOK_SECRET=whsec_... node --experimental-strip-types packages/client/examples/webhook-receiver.mts
 *
 * Then add http(s)://<this host>:8787/doccheck as a webhook in Integrations → Webhooks.
 */
import { createServer } from 'node:http';
import { verifyWebhook } from '../dist/index.js';

const secret = process.env.DOCCHECK_WEBHOOK_SECRET ?? '';
const seen = new Set<string>();

createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    try {
      // The raw body, before any JSON parsing: the signature covers the exact bytes.
      const event = verifyWebhook(secret, Buffer.concat(chunks), req.headers['doccheck-signature'] as string | undefined);
      // Deliveries can repeat (retries, redelivery): the event id says it was already handled.
      if (!seen.has(event.id)) {
        seen.add(event.id);
        console.log(event.type, JSON.stringify(event.data));
      }
      res.writeHead(200).end('ok');
    } catch (err) {
      res.writeHead(400).end((err as Error).message);
    }
  });
}).listen(8787, () => console.log('Listening on http://localhost:8787/doccheck'));
