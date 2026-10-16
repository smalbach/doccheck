import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { AuditService } from '../audit/audit.service';
import { PG_POOL } from '../db/db.module';
import { open, seal, type Sealed } from '../messaging/secret-box';
import { OrgsRepository } from '../orgs/orgs.repository';
import { appUrl } from './app-url';
import { authorizationUrl, discover, exchangeCode, fetchJwks, randomToken, verifyIdToken, type OidcProvider } from './oidc';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
/** How long the round trip to the provider may take. */
const STATE_MINUTES = 10;
/** Discovery and keys are kept this long per issuer. */
const CACHE_MS = 10 * 60_000;

export interface SsoConfig {
  enabled: boolean;
  issuer: string;
  clientId: string;
  hasSecret: boolean;
  emailDomains: string[];
  defaultRole: 'admin' | 'analyst' | 'reviewer' | 'viewer';
  redirectUri?: string;
}

/**
 * OpenID Connect sign-in per organization: any provider (Entra ID, Okta, Google Workspace, Keycloak,
 * Auth0...) configured by issuer, client id and secret (sealed like the mail password). Whoever the
 * provider vouches for with a verified email in the organization's domains signs in: a new account is
 * made for them and joins with the default role; an existing account must already be a member.
 * A domain belongs to one organization's SSO at a time. The provider's own MFA applies; DocCheck's
 * TOTP is for password sign-in.
 */
@Injectable()
export class SsoService {
  private readonly logger = new Logger(SsoService.name);
  private readonly cache = new Map<string, { at: number; provider: OidcProvider; keys?: Awaited<ReturnType<typeof fetchJwks>> }>();

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly orgs: OrgsRepository,
    private readonly audit: AuditService,
  ) {}

  static redirectUri(): string | undefined {
    const base = appUrl();
    return base ? `${base}/auth/sso/callback` : undefined;
  }

  async config(orgId: string): Promise<SsoConfig | null> {
    const { rows } = await this.pool.query('select * from org_sso where org_id = $1', [orgId]);
    const r = rows[0];
    const redirectUri = SsoService.redirectUri();
    if (!r) return null;
    return { enabled: r.enabled, issuer: r.issuer, clientId: r.client_id, hasSecret: true, emailDomains: r.email_domains, defaultRole: r.default_role, ...(redirectUri ? { redirectUri } : {}) };
  }

  /** Saves the configuration after checking the issuer answers its discovery document. */
  async save(orgId: string, userId: string, dto: { enabled: boolean; issuer: string; clientId: string; clientSecret?: string; emailDomains: string[]; defaultRole: SsoConfig['defaultRole'] }) {
    const before = await this.config(orgId);
    if (!dto.clientSecret && !before) throw new BadRequestException('Enter the client secret');
    try {
      await this.provider(dto.issuer, true);
    } catch (err) {
      throw new BadRequestException(`The issuer did not answer as an OpenID provider: ${err instanceof Error ? err.message : err}`);
    }
    if (dto.enabled && !dto.emailDomains.length) throw new BadRequestException('Name the email domains that sign in with SSO');
    if (dto.enabled) {
      const { rows } = await this.pool.query('select o.name from org_sso s join organizations o on o.id = s.org_id where s.enabled and s.org_id <> $1 and s.email_domains && $2', [orgId, dto.emailDomains]);
      if (rows[0]) throw new BadRequestException(`Another organization signs in these domains with SSO (${rows[0].name})`);
    }
    await this.pool.query(
      `insert into org_sso (org_id, enabled, issuer, client_id, client_secret, email_domains, default_role, updated_by)
       values ($1, $2, $3, $4, coalesce($5::jsonb, '{}'::jsonb), $6, $7, $8)
       on conflict (org_id) do update set enabled = excluded.enabled, issuer = excluded.issuer, client_id = excluded.client_id,
         client_secret = coalesce($5::jsonb, org_sso.client_secret), email_domains = excluded.email_domains, default_role = excluded.default_role,
         updated_by = excluded.updated_by, updated_at = now()`,
      [orgId, dto.enabled, dto.issuer.replace(/\/+$/, ''), dto.clientId, dto.clientSecret ? JSON.stringify(seal(dto.clientSecret)) : null, dto.emailDomains, dto.defaultRole, userId],
    );
    const after = await this.config(orgId);
    this.audit.note({ action: 'org.sso', entity: 'organization', entityId: orgId, before, after: { ...after, secretChanged: !!dto.clientSecret } });
    return after;
  }

  async remove(orgId: string) {
    await this.pool.query('delete from org_sso where org_id = $1', [orgId]);
    this.audit.note({ action: 'org.sso.remove', entity: 'organization', entityId: orgId });
  }

  /** The organization that signs this email's domain in with SSO, if any (the sign-in page asks). */
  async discoverByEmail(email: string): Promise<{ orgId: string; orgName: string } | null> {
    const domain = email.trim().toLowerCase().split('@')[1];
    if (!domain) return null;
    const { rows } = await this.pool.query(
      'select o.id, o.name from org_sso s join organizations o on o.id = s.org_id where s.enabled and $1 = any(s.email_domains) limit 1',
      [domain],
    );
    return rows[0] ? { orgId: rows[0].id, orgName: rows[0].name } : null;
  }

  private async provider(issuer: string, fresh = false): Promise<{ provider: OidcProvider; keys: Awaited<ReturnType<typeof fetchJwks>> }> {
    const hit = this.cache.get(issuer);
    if (hit?.keys && !fresh && Date.now() - hit.at < CACHE_MS) return { provider: hit.provider, keys: hit.keys };
    const provider = await discover(issuer);
    const keys = await fetchJwks(provider);
    this.cache.set(issuer, { at: Date.now(), provider, keys });
    return { provider, keys };
  }

  /** Where to send the browser: the provider's sign-in page, with a fresh state, nonce and PKCE verifier. */
  async start(orgId: string, loginHint?: string): Promise<string> {
    const { rows } = await this.pool.query('select * from org_sso where org_id = $1 and enabled', [orgId]);
    const cfg = rows[0];
    const redirectUri = SsoService.redirectUri();
    if (!cfg || !redirectUri) throw new NotFoundException('Single sign-on is not set up for this organization');
    const { provider } = await this.provider(cfg.issuer);
    const state = randomToken();
    const nonce = randomToken();
    const codeVerifier = randomToken(48);
    await this.pool.query('delete from sso_states where expires_at < now()');
    await this.pool.query(`insert into sso_states (state_hash, org_id, nonce, code_verifier, expires_at) values ($1, $2, $3, $4, now() + make_interval(mins => $5))`, [
      sha256(state),
      orgId,
      nonce,
      codeVerifier,
      STATE_MINUTES,
    ]);
    return authorizationUrl(provider, { clientId: cfg.client_id, redirectUri, state, nonce, codeVerifier, ...(loginHint ? { loginHint } : {}) });
  }

  /**
   * The provider sent the browser back: uses the state once, exchanges the code, checks the ID token
   * and the email, and returns the account to sign in (made on first sign-in) in the organization.
   */
  async callback(code: string, state: string): Promise<{ userId: string; orgId: string; email: string }> {
    const { rows } = await this.pool.query('delete from sso_states where state_hash = $1 and expires_at > now() returning *', [sha256(state)]);
    const st = rows[0];
    if (!st) throw new BadRequestException('The sign-in took too long or was already used; start again');
    const { rows: cfgRows } = await this.pool.query('select * from org_sso where org_id = $1 and enabled', [st.org_id]);
    const cfg = cfgRows[0];
    if (!cfg) throw new BadRequestException('Single sign-on is off for this organization');
    const secret = open(cfg.client_secret as Sealed);
    if (!secret) throw new BadRequestException('The client secret cannot be read with this server key: enter it again in the organization settings');
    const { provider, keys } = await this.provider(cfg.issuer);
    const idToken = await exchangeCode(provider, { clientId: cfg.client_id, clientSecret: secret, redirectUri: SsoService.redirectUri()!, code, codeVerifier: st.code_verifier });
    let claims;
    try {
      claims = verifyIdToken(idToken, keys, { issuer: cfg.issuer, clientId: cfg.client_id, nonce: st.nonce });
    } catch {
      // Keys rotate: fetch them again once before refusing.
      const fresh = await this.provider(cfg.issuer, true);
      claims = verifyIdToken(idToken, fresh.keys, { issuer: cfg.issuer, clientId: cfg.client_id, nonce: st.nonce });
    }
    const email = claims.email?.trim().toLowerCase();
    if (!email || claims.email_verified === false || claims.email_verified === 'false') throw new BadRequestException('The provider did not vouch for an email address');
    const domains: string[] = cfg.email_domains;
    if (!domains.includes(email.split('@')[1]!)) throw new BadRequestException(`${email} is not in the domains this organization signs in`);

    let { rows: users } = await this.pool.query('select id from users where email = $1', [email]);
    let userId: string = users[0]?.id;
    // An account that already exists signs in through the provider only once it is a member (by
    // invitation): an organization's provider cannot take over accounts it does not already have.
    if (userId && !(await this.orgs.memberRole(st.org_id, userId))) {
      throw new BadRequestException(`An account for ${email} already exists. Sign in with its password and accept an invitation to this organization first.`);
    }
    if (!userId) {
      userId = randomUUID();
      const name = (claims.name || claims.preferred_username || email.split('@')[0]!).slice(0, 100);
      // No usable password ('!'): the account signs in through the provider, or sets one with "Forgot password?".
      await this.pool.query(`insert into users (id, email, name, password_hash, role) values ($1, $2, $3, '!', 'user') on conflict (email) do nothing`, [userId, email, name]);
      ({ rows: users } = await this.pool.query('select id from users where email = $1', [email]));
      userId = users[0].id;
      await this.orgs.create(userId, name, true);
      this.logger.log(`Account ${email} made on first sign-in through ${cfg.issuer}`);
    }
    if (!(await this.orgs.memberRole(st.org_id, userId))) {
      await this.orgs.addMember(st.org_id, userId, cfg.default_role);
      await this.audit.record({ orgId: st.org_id, userId, email }, { action: 'member.join', entity: 'member', entityId: userId, after: { role: cfg.default_role, via: 'sso' } });
    }
    await this.pool.query('update users set last_org_id = $2 where id = $1', [userId, st.org_id]);
    return { userId, orgId: st.org_id, email };
  }
}
