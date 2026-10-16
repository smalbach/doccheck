// Supplier portal tokens and the link placeholder (built API: npm run build first).
import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.SETTINGS_KEY_FILE = join(mkdtempSync(join(tmpdir(), 'doccheck-portal-key-')), 'settings.key');
delete process.env.SETTINGS_KEY;
process.env.APP_URL = 'https://app.example/';
const require = createRequire(import.meta.url);
const { expandLinks, hashMatches, LINK_PLACEHOLDER, linkToken, portalUrl, tokenHash, verifyToken } = require('../dist/portal/portal-token.js');
const { withLinkLine } = require('../dist/portal/portal-text.js');
const { statusOf } = require('../dist/portal/portal.service.js');

const id = '6f1c1c49-6e8f-4d2e-9f0e-2f4b8a1c0d11';

describe('portal tokens', () => {
  it('names their link only when the signature is this server\'s', () => {
    const token = linkToken(id);
    assert.equal(linkToken(id), token, 'the same link gives the same token');
    assert.equal(verifyToken(token), id);
    const [hex, mac] = token.split('.');
    const flipped = mac.slice(0, -1) + (mac.at(-1) === 'A' ? 'B' : 'A');
    for (const bad of [`${hex}.${flipped}`, `${'0'.repeat(32)}.${mac}`, `${hex}.${mac}.x`, hex, '', 'x'.repeat(500), undefined, 42, `${hex.toUpperCase()}.${mac}`]) {
      assert.equal(verifyToken(bad), null, String(bad));
    }
  });

  it('is stored as a hash, compared in constant time', () => {
    const token = linkToken(id);
    assert.equal(tokenHash(token).length, 32);
    assert.ok(hashMatches(tokenHash(token), token));
    assert.ok(!hashMatches(tokenHash(token), `${token}x`));
    assert.ok(!hashMatches(Buffer.alloc(3), token));
  });

  it('goes in the page fragment, so it is never sent to a server or in a Referer', () => {
    assert.equal(portalUrl('t0k'), 'https://app.example/#/portal?t=t0k');
  });
});

describe('the link in an email', () => {
  it('replaces the placeholder, or drops its line when there is no working link', () => {
    const text = `Hello\nUpload here:\n${LINK_PLACEHOLDER}\nThanks`;
    assert.equal(expandLinks(text, 'https://x/#/portal?t=1'), 'Hello\nUpload here:\nhttps://x/#/portal?t=1\nThanks');
    assert.equal(expandLinks(text, undefined), 'Hello\nUpload here:\nThanks');
    assert.equal(expandLinks('no link', 'u'), 'no link');
  });

  it('adds the line in the email language when the text has no placeholder', () => {
    assert.equal(withLinkLine('Hola', 'correction', 'es'), `Hola\n\nSube los documentos corregidos y mira qué falta corregir:\n${LINK_PLACEHOLDER}`);
    assert.equal(withLinkLine(`Hi ${LINK_PLACEHOLDER}`, 'pre_shipment', 'en'), `Hi ${LINK_PLACEHOLDER}`);
    assert.match(withLinkLine('Hi', 'pre_shipment', 'xx'), /draft invoice/);
  });
});

describe('request status', () => {
  const row = (over) => ({ kind: 'correction', pending: 0, uploads: 0, open: 1, validatedSince: false, ...over });
  it('follows uploads and findings', () => {
    assert.equal(statusOf(row({ closedAt: 'x', pending: 1 })), 'closed');
    assert.equal(statusOf(row({ pending: 1 })), 'checking');
    assert.equal(statusOf(row({ uploads: 1, lastUploadStatus: 'failed' })), 'failed');
    assert.equal(statusOf(row({})), 'waiting');
    assert.equal(statusOf(row({ open: 0, validatedSince: true })), 'clean', 'settled by email or by hand');
    assert.equal(statusOf(row({ kind: 'pre_shipment', open: 0, validatedSince: true })), 'waiting');
    assert.equal(statusOf(row({ uploads: 2, open: 3 })), 'open');
    assert.equal(statusOf(row({ uploads: 2, open: 0 })), 'clean');
  });
});
