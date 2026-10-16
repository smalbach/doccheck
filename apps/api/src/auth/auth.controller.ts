import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, Res, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { appUrl } from './app-url';
import {
  ChangePasswordDto, DeleteAccountDto, ForgotPasswordDto, LanguageDto, LoginDto, MfaCodeDto, MfaDisableDto, MfaLoginDto, RegisterDto, ResetWithTokenDto, SsoDiscoverQuery, UpdateProfileDto,
} from './auth.dto';
import { AuthService, type MfaRequired, type NewSession } from './auth.service';
import type { AuthedRequest, PublicUser, SessionOrigin } from './auth.types';
import { MfaService } from './mfa.service';
import { SsoService } from './sso.service';
import { CurrentUser } from './current-user.decorator';
import { Public } from './public.decorator';
import { clearSessionCookie, setSessionCookie } from './session-cookie';
import { NoOrg } from '../orgs/permissions';

@NoOrg()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly mfa: MfaService,
    private readonly sso: SsoService,
  ) {}

  private open(req: Request, res: Response, session: NewSession): PublicUser {
    setSessionCookie(req, res, session.token, session.expiresAt);
    return session.user;
  }

  private origin(req: Request): SessionOrigin {
    const ua = req.headers['user-agent'];
    return { ip: req.ip, ...(typeof ua === 'string' ? { userAgent: ua } : {}) };
  }

  @Public()
  @Post('register')
  async register(@Body(new ZodValidationPipe(RegisterDto)) dto: RegisterDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.open(req, res, await this.auth.register(dto, req.ip ?? 'unknown', this.origin(req)));
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body(new ZodValidationPipe(LoginDto)) dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<PublicUser | MfaRequired> {
    const result = await this.auth.login(dto, req.ip ?? 'unknown', this.origin(req));
    return 'mfaRequired' in result ? result : this.open(req, res, result);
  }

  /** The second sign-in step on an account with two-factor sign-in: { ticket, code } (or a recovery code). */
  @Public()
  @Post('mfa')
  @HttpCode(200)
  async loginWithCode(@Body(new ZodValidationPipe(MfaLoginDto)) dto: MfaLoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.open(req, res, await this.auth.loginWithCode(dto.ticket, dto.code, this.origin(req)));
  }

  /** Whether two-factor sign-in is on, and how many recovery codes are left. */
  @Get('mfa')
  mfaStatus(@CurrentUser() user: PublicUser) {
    return this.mfa.status(user.id);
  }

  /** A new secret for the authenticator app (otpauth URL for a QR code); on once a code is confirmed. */
  @Post('mfa/setup')
  @HttpCode(200)
  mfaSetup(@CurrentUser() user: PublicUser) {
    return this.mfa.setup(user.id, user.email);
  }

  /** { code } from the app: turns two-factor sign-in on and answers ten recovery codes, shown once. */
  @Post('mfa/enable')
  @HttpCode(200)
  mfaEnable(@CurrentUser() user: PublicUser, @Body(new ZodValidationPipe(MfaCodeDto)) dto: MfaCodeDto) {
    return this.mfa.enable(user.id, dto.code);
  }

  /** { password, code }: turns it off. */
  @Post('mfa/disable')
  @HttpCode(204)
  async mfaDisable(@CurrentUser() user: PublicUser, @Body(new ZodValidationPipe(MfaDisableDto)) dto: MfaDisableDto) {
    await this.auth.checkPassword(user.id, dto.password);
    if (!(await this.mfa.verify(user.id, dto.code))) throw new UnauthorizedException('The code is wrong or expired');
    await this.mfa.disable(user.id);
  }

  /** { code }: replaces the recovery codes (the old ones stop working). */
  @Post('mfa/recovery-codes')
  @HttpCode(200)
  async mfaRecoveryCodes(@CurrentUser() user: PublicUser, @Body(new ZodValidationPipe(MfaCodeDto)) dto: MfaCodeDto) {
    if (!(await this.mfa.verify(user.id, dto.code))) throw new UnauthorizedException('The code is wrong or expired');
    return { recoveryCodes: await this.mfa.replaceRecoveryCodes(user.id) };
  }

  /** The user's signed-in sessions (devices), the current one marked. */
  @Get('sessions')
  sessions(@CurrentUser() user: PublicUser, @Req() req: AuthedRequest) {
    return this.auth.sessions(user.id, req.sessionTokenHash);
  }

  /** Signs one session out (any device of the user's). */
  @Delete('sessions/:id')
  @HttpCode(204)
  async revokeSession(@CurrentUser() user: PublicUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.auth.revokeSession(user.id, id);
  }

  /** ?email=: the organization that signs this email in with SSO, or { sso: false }. */
  @Public()
  @Get('sso/discover')
  async ssoDiscover(@Query(new ZodValidationPipe(SsoDiscoverQuery)) q: SsoDiscoverQuery) {
    const found = await this.sso.discoverByEmail(q.email);
    return found ? { sso: true, ...found } : { sso: false };
  }

  /** Sends the browser to the organization's identity provider. */
  @Public()
  @Get('sso/:orgId/start')
  async ssoStart(@Param('orgId', ParseUUIDPipe) orgId: string, @Query('login_hint') loginHint: unknown, @Res() res: Response) {
    res.redirect(302, await this.sso.start(orgId, typeof loginHint === 'string' ? loginHint.slice(0, 254) : undefined));
  }

  /** The provider sends the browser back here; on success the session starts and the app opens. */
  @Public()
  @Get('sso/callback')
  async ssoCallback(@Query('code') code: unknown, @Query('state') state: unknown, @Query('error') error: unknown, @Req() req: Request, @Res() res: Response) {
    const app = appUrl() ?? '';
    try {
      if (typeof error === 'string') throw new BadRequestException(`The provider refused: ${error}`);
      if (typeof code !== 'string' || typeof state !== 'string') throw new BadRequestException('Missing code or state');
      const { userId, orgId } = await this.sso.callback(code, state);
      const session = await this.auth.ssoSession(userId, orgId, this.origin(req));
      setSessionCookie(req, res, session.token, session.expiresAt);
      res.redirect(302, `${app}/#/app`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.redirect(302, `${app}/#/login?sso_error=${encodeURIComponent(message.slice(0, 300))}`);
    }
  }

  /** Emails a reset link if the account exists; the answer is the same either way. */
  @Public()
  @Post('forgot-password')
  @HttpCode(202)
  forgotPassword(@Body(new ZodValidationPipe(ForgotPasswordDto)) dto: ForgotPasswordDto, @Req() req: Request) {
    this.auth.forgotPassword(dto.email, req.ip ?? 'unknown');
    return { message: 'If an account exists for this email, a reset link is on its way.' };
  }

  /** Body { token, newPassword }: sets the password from an emailed link and signs out every session. */
  @Public()
  @Post('reset-password')
  @HttpCode(204)
  async resetPassword(@Body(new ZodValidationPipe(ResetWithTokenDto)) dto: ResetWithTokenDto) {
    await this.auth.resetWithToken(dto);
  }

  /** Always succeeds, signed in or not, and clears the cookie. */
  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request & AuthedRequest, @Res({ passthrough: true }) res: Response) {
    if (req.sessionTokenHash) await this.auth.logout(req.sessionTokenHash);
    clearSessionCookie(req, res);
  }

  @Get('me')
  me(@CurrentUser() user: PublicUser) {
    return user;
  }

  @Patch('me')
  updateProfile(@CurrentUser() user: PublicUser, @Body(new ZodValidationPipe(UpdateProfileDto)) dto: UpdateProfileDto) {
    return this.auth.updateProfile(user.id, dto.name);
  }

  @Put('me/language')
  @HttpCode(204)
  async setLanguage(@CurrentUser() user: PublicUser, @Body(new ZodValidationPipe(LanguageDto)) dto: LanguageDto) {
    await this.auth.setLanguage(user.id, dto.language);
  }

  /** Body { password }: deletes the account with its shipments and PDFs, and signs out. */
  @Delete('me')
  @HttpCode(204)
  async deleteAccount(
    @CurrentUser() user: PublicUser,
    @Body(new ZodValidationPipe(DeleteAccountDto)) dto: DeleteAccountDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.deleteAccount(user.id, dto);
    clearSessionCookie(req, res);
  }

  @Post('password')
  @HttpCode(204)
  async changePassword(@CurrentUser() user: PublicUser, @Req() req: AuthedRequest, @Body(new ZodValidationPipe(ChangePasswordDto)) dto: ChangePasswordDto) {
    if (!req.sessionTokenHash) throw new UnauthorizedException();
    await this.auth.changePassword(user.id, req.sessionTokenHash, dto);
  }
}
