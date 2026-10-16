import { BadRequestException, HttpException, HttpStatus, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { open, seal, type Sealed } from '../messaging/secret-box';
import { newRecoveryCodes, newTotpSecret, normalizeRecoveryCode, otpauthUrl, verifyTotp } from './totp';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** How long the step between password and code may take, and how many codes may be tried. */
const CHALLENGE_MINUTES = 5;
const CHALLENGE_ATTEMPTS = 5;
const INVALID_CODE = 'The code is wrong or expired';

/**
 * Two-factor sign-in with an authenticator app (TOTP) and single-use recovery codes. The secret is
 * sealed with the settings key like the mail password; recovery codes are stored as SHA-256 only.
 */
@Injectable()
export class MfaService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async enabled(userId: string): Promise<boolean> {
    const { rows } = await this.pool.query('select mfa_enabled_at is not null as on from users where id = $1', [userId]);
    return rows[0]?.on === true;
  }

  async status(userId: string): Promise<{ enabled: boolean; recoveryCodesLeft: number }> {
    const { rows } = await this.pool.query(
      'select mfa_enabled_at is not null as on, (select count(*)::int from mfa_recovery_codes where user_id = $1 and used_at is null) as left from users where id = $1',
      [userId],
    );
    return { enabled: rows[0]?.on === true, recoveryCodesLeft: rows[0]?.left ?? 0 };
  }

  /** A new secret to scan; it takes effect once a code from it is confirmed (enable). */
  async setup(userId: string, email: string): Promise<{ secret: string; otpauthUrl: string }> {
    if (await this.enabled(userId)) throw new BadRequestException('Two-factor sign-in is already on');
    const secret = newTotpSecret();
    await this.pool.query('update users set mfa_pending_secret = $2 where id = $1', [userId, JSON.stringify(seal(secret))]);
    return { secret, otpauthUrl: otpauthUrl(secret, email) };
  }

  /** Confirms the pending secret with a code from the app; answers the recovery codes, shown once. */
  async enable(userId: string, code: string): Promise<{ recoveryCodes: string[] }> {
    const { rows } = await this.pool.query<{ mfa_pending_secret: Sealed | null }>('select mfa_pending_secret from users where id = $1', [userId]);
    const pending = rows[0]?.mfa_pending_secret;
    const secret = pending ? open(pending) : undefined;
    if (!secret) throw new BadRequestException('Start the setup again');
    const counter = verifyTotp(secret, code);
    if (counter === null) throw new BadRequestException(INVALID_CODE);
    await this.pool.query(
      'update users set mfa_secret = mfa_pending_secret, mfa_pending_secret = null, mfa_enabled_at = now(), mfa_last_counter = $2 where id = $1',
      [userId, counter],
    );
    return { recoveryCodes: await this.replaceRecoveryCodes(userId) };
  }

  async disable(userId: string): Promise<void> {
    await this.pool.query('update users set mfa_secret = null, mfa_pending_secret = null, mfa_enabled_at = null, mfa_last_counter = null where id = $1', [userId]);
    await this.pool.query('delete from mfa_recovery_codes where user_id = $1', [userId]);
  }

  async replaceRecoveryCodes(userId: string): Promise<string[]> {
    const codes = newRecoveryCodes();
    await this.pool.query('delete from mfa_recovery_codes where user_id = $1', [userId]);
    await this.pool.query('insert into mfa_recovery_codes (user_id, code_hash) select $1, unnest($2::text[])', [userId, codes.map((c) => sha256(normalizeRecoveryCode(c)))]);
    return codes;
  }

  /**
   * A code from the app (each time step once) or an unused recovery code (used up). The update is
   * conditional, so two requests with the same code cannot both pass.
   */
  async verify(userId: string, code: string): Promise<boolean> {
    const { rows } = await this.pool.query<{ mfa_secret: Sealed | null }>('select mfa_secret from users where id = $1 and mfa_enabled_at is not null', [userId]);
    const secret = rows[0]?.mfa_secret ? open(rows[0].mfa_secret) : undefined;
    if (!secret) return false;
    const counter = verifyTotp(secret, code);
    if (counter !== null) {
      const res = await this.pool.query('update users set mfa_last_counter = $2 where id = $1 and (mfa_last_counter is null or mfa_last_counter < $2)', [userId, counter]);
      return res.rowCount === 1;
    }
    const res = await this.pool.query('update mfa_recovery_codes set used_at = now() where user_id = $1 and code_hash = $2 and used_at is null', [
      userId,
      sha256(normalizeRecoveryCode(code)),
    ]);
    return res.rowCount === 1;
  }

  /** The ticket between a right password and the code. */
  async challenge(userId: string, orgId?: string): Promise<string> {
    const ticket = randomBytes(32).toString('base64url');
    await this.pool.query('delete from mfa_challenges where expires_at < now()');
    await this.pool.query(
      `insert into mfa_challenges (token_hash, user_id, org_id, expires_at) values ($1, $2, $3, now() + make_interval(mins => $4))`,
      [sha256(ticket), userId, orgId ?? null, CHALLENGE_MINUTES],
    );
    return ticket;
  }

  /** The user (and organization, for SSO) of a ticket whose code is right; the ticket is used up. */
  async redeem(ticket: string, code: string): Promise<{ userId: string; orgId?: string }> {
    const hash = sha256(ticket);
    const { rows } = await this.pool.query(
      'update mfa_challenges set attempts = attempts + 1 where token_hash = $1 and expires_at > now() returning user_id, org_id, attempts',
      [hash],
    );
    const c = rows[0];
    if (!c) throw new UnauthorizedException('Sign in again');
    if (c.attempts > CHALLENGE_ATTEMPTS) {
      await this.pool.query('delete from mfa_challenges where token_hash = $1', [hash]);
      throw new HttpException('Too many wrong codes. Sign in again.', HttpStatus.TOO_MANY_REQUESTS);
    }
    if (!(await this.verify(c.user_id, code))) throw new UnauthorizedException(INVALID_CODE);
    await this.pool.query('delete from mfa_challenges where token_hash = $1', [hash]);
    return { userId: c.user_id, ...(c.org_id ? { orgId: c.org_id } : {}) };
  }
}
