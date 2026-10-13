import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, HttpException, HttpStatus, Inject, Injectable, Logger, UnauthorizedException, type OnApplicationBootstrap } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Mailer } from '../mail/mailer';
import { STORAGE, type ObjectStorage } from '../storage/storage';
import { appUrl } from './app-url';
import { adminEmails } from './admin-emails';
import { AuthRepository } from './auth.repository';
import type { ChangePasswordDto, DeleteAccountDto, LoginDto, RegisterDto, ResetWithTokenDto } from './auth.dto';
import type { PublicUser, UserRow } from './auth.types';
import { LoginThrottle } from './login-throttle';
import { registrationOpen } from './registration-open';
import { resetEmail } from './reset-email';
import { ResetThrottle } from './reset-throttle';
import { SignupThrottle } from './signup-throttle';
import { hashPassword, verifyPassword } from './password';
import { SESSION_DAYS } from './session-cookie';

const publicUser = ({ passwordHash: _, ...user }: UserRow): PublicUser => user;
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

// Compared against when the email is unknown, so a miss takes as long as a wrong password.
const DUMMY_HASH = hashPassword(randomBytes(16).toString('hex'));

/** How long an emailed reset link works. */
const RESET_MINUTES = 30;
const INVALID_RESET = 'This reset link is invalid, expired or already used';

export interface NewSession {
  user: PublicUser;
  token: string;
  expiresAt: Date;
}

@Injectable()
export class AuthService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly repo: AuthRepository,
    private readonly throttle: LoginThrottle,
    private readonly signups: SignupThrottle,
    private readonly resets: ResetThrottle,
    private readonly mailer: Mailer,
    @Inject(STORAGE) private readonly storage: ObjectStorage,
  ) {}

  /** Accounts listed in ADMIN_EMAILS that already exist become admins (after migrations ran). */
  async onApplicationBootstrap() {
    const promoted = await this.repo.promoteAdmins(adminEmails());
    if (promoted) this.logger.log(`${promoted} account(s) made admin from ADMIN_EMAILS`);
    if (!appUrl()) this.logger.warn('APP_URL is not set: "Forgot password?" emails cannot be sent');
  }

  private async startSession(user: PublicUser): Promise<NewSession> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
    await this.repo.createSession(hashToken(token), user.id, expiresAt);
    return { user, token, expiresAt };
  }

  async register(dto: RegisterDto, ip: string): Promise<NewSession> {
    const role = adminEmails().includes(dto.email) ? 'admin' : 'user';
    if (role !== 'admin' && !registrationOpen()) throw new ForbiddenException('Registration is closed on this server');
    const wait = this.signups.retryAfter(ip);
    if (wait > 0) throw new HttpException(`Too many accounts created from this address. Try again in ${Math.ceil(wait / 60)} minute(s).`, HttpStatus.TOO_MANY_REQUESTS);
    const user = { id: randomUUID(), email: dto.email, name: dto.name, passwordHash: await hashPassword(dto.password), role } as const;
    if (!(await this.repo.createUser(user))) throw new ConflictException('An account with this email already exists');
    this.signups.record(ip);
    return this.startSession({ id: user.id, email: user.email, name: user.name, role, createdAt: new Date().toISOString() });
  }

  async login(dto: LoginDto, ip: string): Promise<NewSession> {
    const wait = this.throttle.retryAfter(dto.email, ip);
    if (wait > 0) throw new HttpException(`Too many failed sign-ins. Try again in ${Math.ceil(wait / 60)} minute(s).`, HttpStatus.TOO_MANY_REQUESTS);
    const user = await this.repo.findByEmail(dto.email);
    const ok = await verifyPassword(dto.password, user?.passwordHash ?? (await DUMMY_HASH));
    if (!user || !ok) {
      this.throttle.fail(dto.email, ip);
      throw new UnauthorizedException('Wrong email or password');
    }
    this.throttle.succeed(dto.email);
    return this.startSession(publicUser(user));
  }

  logout(tokenHash: string): Promise<void> {
    return this.repo.deleteSession(tokenHash);
  }

  sessionUser(token: string): Promise<PublicUser | null> {
    return this.repo.sessionUser(hashToken(token));
  }

  async updateProfile(userId: string, name: string): Promise<PublicUser> {
    await this.repo.updateName(userId, name);
    const user = await this.repo.findById(userId);
    if (!user) throw new UnauthorizedException();
    return publicUser(user);
  }

  /**
   * An admin sets another user's password (for users without email access): every session of that user is
   * signed out, and the change is logged with who made it.
   */
  async resetPassword(admin: PublicUser, userId: string, newPassword: string): Promise<void> {
    if (admin.id === userId) throw new BadRequestException('Change your own password from Account');
    const user = await this.repo.findById(userId);
    if (!user) throw new NotFoundException(`User ${userId} not found`);
    await this.repo.updatePasswordHash(userId, await hashPassword(newPassword));
    await this.repo.deleteOtherSessions(userId);
    this.logger.log(`Password of ${user.email} reset by admin ${admin.email}; their sessions were signed out`);
  }

  /** The account and everything in it, PDFs included; refused while a document is extracting. */
  async deleteAccount(userId: string, dto: DeleteAccountDto): Promise<void> {
    const user = await this.repo.findById(userId);
    if (!user || !(await verifyPassword(dto.password, user.passwordHash))) throw new UnauthorizedException('The password is wrong');
    const res = await this.repo.deleteUser(userId);
    if (res === 'pending') throw new ConflictException('Documents are still being extracted; delete the account when they are done');
    const failed = (await Promise.all(res.keys.map((k) => this.storage.delete(k).then(() => null, (err: Error) => `${k} (${err.message})`)))).filter(Boolean);
    if (failed.length) this.logger.warn(`Account ${userId} deleted, but these PDFs could not be removed from storage: ${failed.join(', ')}`);
  }

  /**
   * "Forgot password?": answers the same whether or not the email has an account. The link is made
   * and emailed after answering, so a known email does not answer slower than an unknown one.
   */
  forgotPassword(email: string, ip: string): void {
    const wait = this.resets.retryAfter(email, ip);
    if (wait > 0) throw new HttpException(`Too many reset requests. Try again in ${Math.ceil(wait / 60)} minute(s).`, HttpStatus.TOO_MANY_REQUESTS);
    this.resets.record(email, ip);
    void this.emailResetLink(email).catch((err: Error) => this.logger.error(`Password reset email for ${email} failed: ${err.message}`));
  }

  private async emailResetLink(email: string): Promise<void> {
    const user = await this.repo.findByEmail(email);
    if (!user) return;
    const base = appUrl();
    if (!base) return this.logger.error(`APP_URL is not set: no reset link sent to ${user.email}`);
    const token = randomBytes(32).toString('base64url');
    await this.repo.createPasswordReset(hashToken(token), user.id, new Date(Date.now() + RESET_MINUTES * 60 * 1000));
    await this.mailer.send(resetEmail(user.email, `${base}/#/reset-password?token=${token}`, RESET_MINUTES));
    this.logger.log(`Password reset link issued for ${user.email}`);
  }

  /** Sets the password from an emailed link: the link is used up and the user is signed out everywhere. */
  async resetWithToken(dto: ResetWithTokenDto): Promise<void> {
    const tokenHash = hashToken(dto.token);
    const user = await this.repo.passwordResetUser(tokenHash);
    if (!user) throw new BadRequestException(INVALID_RESET);
    // Checked again inside the transaction: two requests with the same link cannot both win.
    if (!(await this.repo.redeemPasswordReset(tokenHash, user.id, await hashPassword(dto.newPassword)))) throw new BadRequestException(INVALID_RESET);
    this.logger.log(`Password of ${user.email} reset with an emailed link; their sessions were signed out`);
  }

  /** Other sessions are signed out; the current one stays. */
  async changePassword(userId: string, currentTokenHash: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.repo.findById(userId);
    if (!user || !(await verifyPassword(dto.currentPassword, user.passwordHash))) throw new UnauthorizedException('The current password is wrong');
    await this.repo.updatePasswordHash(userId, await hashPassword(dto.newPassword));
    await this.repo.deleteOtherSessions(userId, currentTokenHash);
  }
}
