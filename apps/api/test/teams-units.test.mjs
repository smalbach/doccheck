// Unit tests of the pieces behind organizations and sign-in (built API: npm run build first): TOTP
// against the RFC 6238 test vectors, ID token checks, the role matrix and audit redaction.
import { createSign, generateKeyPairSync } from 'node:crypto';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
require('reflect-metadata');
const { base32Decode, base32Encode, hotp, newRecoveryCodes, normalizeRecoveryCode, otpauthUrl, totp, verifyTotp } = require('../dist/auth/totp.js');
const { pkceChallenge, verifyIdToken } = require('../dist/auth/oidc.js');
const { can, permissionsOf, PERMISSIONS, ORG_ROLES } = require('../dist/orgs/permissions.js');
const { redact } = require('../dist/audit/audit.service.js');

describe('TOTP', () => {
  // RFC 6238 appendix B, SHA-1 key "12345678901234567890", 8 digits there; the last 6 are the same code mod 10^6.
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  it('matches the RFC 6238 test vectors', () => {
    for (const [seconds, code] of [
      [59, '287082'],
      [1111111109, '081804'],
      [1111111111, '050471'],
      [1234567890, '005924'],
      [2000000000, '279037'],
    ]) {
      assert.equal(totp(secret, seconds * 1000), code, String(seconds));
    }
  });

  it('round-trips base32 and accepts one step of drift, nothing more', () => {
    assert.deepEqual(base32Decode(base32Encode(Buffer.from('hello world'))), Buffer.from('hello world'));
    const at = 1_700_000_000_000;
    assert.notEqual(verifyTotp(secret, totp(secret, at - 30_000), at), null);
    assert.notEqual(verifyTotp(secret, totp(secret, at + 30_000), at), null);
    assert.equal(verifyTotp(secret, totp(secret, at - 90_000), at), null);
    assert.equal(verifyTotp(secret, 'abcdef', at), null);
    assert.equal(hotp(base32Decode(secret), 0), '755224'); // RFC 4226 appendix D
  });

  it('makes recovery codes and the otpauth URL apps read', () => {
    const codes = newRecoveryCodes();
    assert.equal(new Set(codes).size, 10);
    assert.ok(codes.every((c) => /^[a-z2-7]{5}-[a-z2-7]{5}$/.test(c)));
    assert.equal(normalizeRecoveryCode(' ABCDE-fghij '), 'abcdefghij');
    assert.equal(otpauthUrl('JBSWY3DPEHPK3PXP', 'ada@example.com'), 'otpauth://totp/DocCheck%3Aada%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=DocCheck&algorithm=SHA1&digits=6&period=30');
  });
});

describe('OpenID Connect ID token', () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'a' };
  const now = 1_800_000_000;
  const claims = { iss: 'https://id.example', sub: 'u1', aud: 'client', exp: now + 300, iat: now, nonce: 'n1', email: 'a@x.example' };
  const sign = (c, key = privateKey, header = { alg: 'RS256', kid: 'a' }) => {
    const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const data = `${enc(header)}.${enc(c)}`;
    return `${data}.${createSign('sha256').update(data).sign(key).toString('base64url')}`;
  };
  const expected = { issuer: 'https://id.example/', clientId: 'client', nonce: 'n1', nowSeconds: now };

  it('accepts a token signed by the provider for this client and nonce', () => {
    assert.equal(verifyIdToken(sign(claims), [jwk], expected).email, 'a@x.example');
  });

  it('refuses every way a token can be wrong', () => {
    const refuses = (token, re, exp = expected) => assert.throws(() => verifyIdToken(token, [jwk], exp), re);
    refuses(sign(claims, other.privateKey), /Bad signature/);
    refuses(sign(claims, privateKey, { alg: 'none' }), /Unsupported/);
    refuses(sign(claims, privateKey, { alg: 'HS256' }), /Unsupported/);
    refuses(sign(claims, privateKey, { alg: 'RS256', kid: 'b' }), /No provider key/);
    refuses(sign({ ...claims, iss: 'https://evil.example' }), /Wrong issuer/);
    refuses(sign({ ...claims, aud: 'another' }), /Wrong audience/);
    refuses(sign({ ...claims, aud: ['client', 'another'] }), /Wrong authorized party/);
    refuses(sign({ ...claims, exp: now - 600 }), /Expired/);
    refuses(sign({ ...claims, iat: now + 600 }), /future/);
    refuses(sign({ ...claims, nonce: 'other' }), /Wrong nonce/);
    refuses('a.b', /Not a signed JWT/);
    // A token with its payload swapped keeps the old signature.
    const [h, , s] = sign(claims).split('.');
    refuses(`${h}.${Buffer.from(JSON.stringify({ ...claims, email: 'boss@x.example' })).toString('base64url')}.${s}`, /Bad signature/);
  });

  it('makes the S256 PKCE challenge (RFC 7636 appendix B)', () => {
    assert.equal(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
});

describe('roles', () => {
  it('give each role what it needs and no more', () => {
    assert.deepEqual(permissionsOf('client'), ['shipment.read']);
    assert.deepEqual(permissionsOf('viewer'), ['shipment.read', 'data.read']);
    assert.ok(can('reviewer', 'finding.approve') && can('reviewer', 'finding.decide') && !can('reviewer', 'shipment.write'));
    assert.ok(can('analyst', 'shipment.write') && !can('analyst', 'finding.approve') && !can('analyst', 'members.manage'));
    assert.ok(can('admin', 'members.manage') && can('admin', 'audit.read') && !can('admin', 'org.delete'));
    assert.deepEqual(ORG_ROLES.filter((r) => can(r, 'org.delete')), ['owner']);
    assert.equal(can(undefined, 'shipment.read'), false);
    // The owner can do everything.
    assert.deepEqual(permissionsOf('owner'), Object.keys(PERMISSIONS));
  });
});

describe('audit redaction', () => {
  it('drops secrets and cuts what is too long', () => {
    assert.deepEqual(redact({ email: 'a@b.c', password: 'x', newPassword: 'y', nested: { clientSecret: 'z', code: '123456', ok: 1 }, list: [{ token: 't' }] }), {
      email: 'a@b.c',
      password: '[redacted]',
      newPassword: '[redacted]',
      nested: { clientSecret: '[redacted]', code: '[redacted]', ok: 1 },
      list: [{ token: '[redacted]' }],
    });
    assert.equal(redact('x'.repeat(3000)).length, 2001);
    assert.equal(redact(Buffer.alloc(10)), '<10 bytes>');
  });
});
