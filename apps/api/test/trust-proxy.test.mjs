// TRUST_PROXY parsing (built API: npm run build first). Behind a host's edge proxy (Fly.io, Render)
// TRUST_PROXY=1 must mean one hop, so the visitor's address counts for the sign-up limit and the
// session cookie is Secure; Express alone would read "1" as an address and trust nothing.
import express from 'express';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { trustProxySetting } = require('../dist/trust-proxy.js');

describe('TRUST_PROXY', () => {
  it('parses hop counts and booleans, passes names and addresses through', () => {
    assert.equal(trustProxySetting(undefined), 'loopback');
    assert.equal(trustProxySetting(''), 'loopback');
    assert.equal(trustProxySetting('1'), 1);
    assert.equal(trustProxySetting(' 2 '), 2);
    assert.equal(trustProxySetting('true'), true);
    assert.equal(trustProxySetting('false'), false);
    assert.equal(trustProxySetting('loopback'), 'loopback');
    assert.equal(trustProxySetting('10.0.0.0/8, 127.0.0.1'), '10.0.0.0/8, 127.0.0.1');
  });

  it('with one hop, the client address and protocol come from the edge proxy', async () => {
    const app = express();
    app.set('trust proxy', trustProxySetting('1'));
    app.get('/', (req, res) => res.json({ ip: req.ip, secure: req.secure }));
    const server = await new Promise((done) => {
      const s = app.listen(0, '127.0.0.1', () => done(s));
    });
    try {
      // A visitor may send its own X-Forwarded-For; the edge appends the real address last.
      const res = await fetch(`http://127.0.0.1:${server.address().port}/`, { headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.7', 'x-forwarded-proto': 'https' } });
      assert.deepEqual(await res.json(), { ip: '203.0.113.7', secure: true });
    } finally {
      server.close();
    }
  });

  it('every value it returns is accepted by Express', () => {
    for (const v of ['1', 'true', 'false', 'loopback', 'uniquelocal', '10.0.0.0/8']) {
      const app = express();
      assert.doesNotThrow(() => app.set('trust proxy', trustProxySetting(v)), v);
    }
  });
});
