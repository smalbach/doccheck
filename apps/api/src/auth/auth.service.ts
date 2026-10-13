import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, HttpException, HttpStatus, Inject, Injectable, Logger, UnauthorizedException, type OnApplicationBootstrap } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { STORAGE, type ObjectStorage } from '../storage/storage';
import { adminEmails } from './admin-emails';
import { AuthRepository } from './auth.repository';
import type { ChangePasswordDto, DeleteAccountDto, LoginDto, RegisterDto } from './auth.dto';
import type { PublicUser, UserRow } from './auth.types';
import { LoginThrottle } from './login-throttle';
import { registrationOpen } from './registration-open';
import { SignupThrottle } from './signup-throttle';
import { hashPassword, verifyPassword } from './password';
import { SESSION_DAYS } from './session-cookie';

const publicUser = ({ passwordHash: _, ...user }: UserRow): PublicUser => user;
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

// Compared against when the email is unknown, so a miss takes as long as a wrong password.
const DUMMY_HASH = hashPassword(randomBytes(16).toString('hex'));

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
    @Inject(STORAGE) private readonly storage: ObjectStorage,
  ) {}

  /** Accounts listed in ADMIN_EMAILS that already exist become admins (after migrations ran). */
  async onApplicationBootstrap() {
    const promoted = await this.repo.promoteAdmins(adminEmails());
    if (promoted) this.logger.log(`${promoted} account(s) made admin from ADMIN_EMAILS`);
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
   * An admin sets another user's password (there is no email reset): every session of that user is
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

  /** Other sessions are signed out; the current one stays. */
  async changePassword(userId: string, currentTokenHash: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.repo.findById(userId);
    if (!user || !(await verifyPassword(dto.currentPassword, user.passwordHash))) throw new UnauthorizedException('The current password is wrong');
    await this.repo.updatePasswordHash(userId, await hashPassword(dto.newPassword));
    await this.repo.deleteOtherSessions(userId, currentTokenHash);
  }
}
