import { createHash, createPublicKey, randomBytes, verify as verifySignature, constants, type JsonWebKey, type KeyObject } from 'node:crypto';

/**
 * The parts of OpenID Connect a confidential web client needs (authorization code flow with PKCE),
 * on node:crypto alone: discovery, the authorization URL, the token request and ID token checks.
 */

export interface OidcProvider {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

export interface IdTokenClaims {
  iss: string;
  sub: string;
  aud: string | string[];
  exp: number;
  iat: number;
  nonce?: string;
  azp?: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  preferred_username?: string;
}

const b64url = (b: Buffer) => b.toString('base64url');
export const randomToken = (bytes = 32) => b64url(randomBytes(bytes));
/** PKCE S256 challenge of a verifier (RFC 7636). */
export const pkceChallenge = (verifier: string) => b64url(createHash('sha256').update(verifier).digest());

const TIMEOUT_MS = 10_000;

async function getJson(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' });
  const text = await res.text();
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text) as Record<string, unknown>;
}

/** The provider's endpoints from its discovery document; its issuer must be the configured one. */
export async function discover(issuer: string): Promise<OidcProvider> {
  const base = issuer.replace(/\/+$/, '');
  const doc = await getJson(`${base}/.well-known/openid-configuration`);
  if (typeof doc.issuer !== 'string' || doc.issuer.replace(/\/+$/, '') !== base) throw new Error(`The discovery document names issuer ${String(doc.issuer)}, not ${base}`);
  for (const key of ['authorization_endpoint', 'token_endpoint', 'jwks_uri'] as const) {
    if (typeof doc[key] !== 'string' || !/^https?:\/\//.test(doc[key] as string)) throw new Error(`The discovery document has no ${key}`);
  }
  return doc as unknown as OidcProvider;
}

export function authorizationUrl(p: OidcProvider, o: { clientId: string; redirectUri: string; state: string; nonce: string; codeVerifier: string; loginHint?: string }): string {
  const url = new URL(p.authorization_endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', o.clientId);
  url.searchParams.set('redirect_uri', o.redirectUri);
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', o.state);
  url.searchParams.set('nonce', o.nonce);
  url.searchParams.set('code_challenge', pkceChallenge(o.codeVerifier));
  url.searchParams.set('code_challenge_method', 'S256');
  if (o.loginHint) url.searchParams.set('login_hint', o.loginHint);
  return url.toString();
}

/** Exchanges the code for tokens (client_secret_post), returning the ID token. */
export async function exchangeCode(p: OidcProvider, o: { clientId: string; clientSecret: string; redirectUri: string; code: string; codeVerifier: string }): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: o.code,
    redirect_uri: o.redirectUri,
    client_id: o.clientId,
    client_secret: o.clientSecret,
    code_verifier: o.codeVerifier,
  });
  const tokens = await getJson(p.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body });
  if (typeof tokens.id_token !== 'string') throw new Error('The provider returned no ID token');
  return tokens.id_token;
}

const ALGORITHMS: Record<string, { hash: string; kty: string; options?: object }> = {
  RS256: { hash: 'sha256', kty: 'RSA' },
  RS384: { hash: 'sha384', kty: 'RSA' },
  RS512: { hash: 'sha512', kty: 'RSA' },
  PS256: { hash: 'sha256', kty: 'RSA', options: { padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 } },
  ES256: { hash: 'sha256', kty: 'EC', options: { dsaEncoding: 'ieee-p1363' } },
  ES384: { hash: 'sha384', kty: 'EC', options: { dsaEncoding: 'ieee-p1363' } },
};

export async function fetchJwks(p: OidcProvider): Promise<(JsonWebKey & { kid?: string; alg?: string; use?: string })[]> {
  const doc = await getJson(p.jwks_uri);
  return Array.isArray(doc.keys) ? (doc.keys as (JsonWebKey & { kid?: string })[]) : [];
}

/**
 * Checks an ID token as OpenID Connect Core 3.1.3.7 asks: signature by one of the provider's keys
 * (never "none" or a shared secret), issuer, audience (and azp when several), expiry, issue time and
 * nonce. Returns its claims, or throws saying what failed.
 */
export function verifyIdToken(
  token: string,
  keys: (JsonWebKey & { kid?: string; use?: string })[],
  expected: { issuer: string; clientId: string; nonce: string; nowSeconds?: number; skewSeconds?: number },
): IdTokenClaims {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Not a signed JWT');
  const [h, p, s] = parts as [string, string, string];
  const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8')) as { alg?: string; kid?: string };
  const alg = header.alg && ALGORITHMS[header.alg];
  if (!alg) throw new Error(`Unsupported signature algorithm ${header.alg}`);
  const candidates = keys.filter((k) => k.kty === alg.kty && (!k.use || k.use === 'sig') && (!header.kid || k.kid === header.kid));
  if (!candidates.length) throw new Error('No provider key matches the token');
  const data = Buffer.from(`${h}.${p}`);
  const signature = Buffer.from(s, 'base64url');
  const valid = candidates.some((jwk) => {
    let key: KeyObject;
    try {
      key = createPublicKey({ key: jwk, format: 'jwk' });
    } catch {
      return false;
    }
    return verifySignature(alg.hash, data, { key, ...(alg.options ?? {}) } as never, signature);
  });
  if (!valid) throw new Error('Bad signature');
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString('utf8')) as IdTokenClaims;
  const now = expected.nowSeconds ?? Math.floor(Date.now() / 1000);
  const skew = expected.skewSeconds ?? 120;
  if (claims.iss?.replace(/\/+$/, '') !== expected.issuer.replace(/\/+$/, '')) throw new Error('Wrong issuer');
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(expected.clientId)) throw new Error('Wrong audience');
  if (aud.length > 1 && claims.azp !== expected.clientId) throw new Error('Wrong authorized party');
  if (typeof claims.exp !== 'number' || claims.exp + skew < now) throw new Error('Expired');
  if (typeof claims.iat === 'number' && claims.iat - skew > now) throw new Error('Issued in the future');
  if (claims.nonce !== expected.nonce) throw new Error('Wrong nonce');
  if (typeof claims.sub !== 'string' || !claims.sub) throw new Error('No subject');
  return claims;
}
