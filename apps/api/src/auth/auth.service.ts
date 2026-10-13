import { ConflictException, HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { AuthRepository } from './auth.repository';
import type { ChangePasswordDto, LoginDto, RegisterDto } from './auth.dto';
import type { PublicUser, UserRow } from './auth.types';
import { LoginThrottle } from './login-throttle';
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
export class AuthService {
  constructor(
    private readonly repo: AuthRepository,
    private readonly throttle: LoginThrottle,
  ) {}

  private async startSession(user: PublicUser): Promise<NewSession> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
    await this.repo.createSession(hashToken(token), user.id, expiresAt);
    return { user, token, expiresAt };
  }

  async register(dto: RegisterDto): Promise<NewSession> {
    const user = { id: randomUUID(), email: dto.email, name: dto.name, passwordHash: await hashPassword(dto.password) };
    if (!(await this.repo.createUser(user))) throw new ConflictException('An account with this email already exists');
    return this.startSession({ id: user.id, email: user.email, name: user.name, createdAt: new Date().toISOString() });
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

  /** Other sessions are signed out; the current one stays. */
  async changePassword(userId: string, currentTokenHash: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.repo.findById(userId);
    if (!user || !(await verifyPassword(dto.currentPassword, user.passwordHash))) throw new UnauthorizedException('The current password is wrong');
    await this.repo.updatePasswordHash(userId, await hashPassword(dto.newPassword));
    await this.repo.deleteOtherSessions(userId, currentTokenHash);
  }
}
