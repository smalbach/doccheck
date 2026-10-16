import { Body, Controller, Delete, Get, HttpCode, Patch, Post, Put, Req, Res, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ChangePasswordDto, DeleteAccountDto, ForgotPasswordDto, LanguageDto, LoginDto, RegisterDto, ResetWithTokenDto, UpdateProfileDto } from './auth.dto';
import { AuthService, type NewSession } from './auth.service';
import type { AuthedRequest, PublicUser } from './auth.types';
import { CurrentUser } from './current-user.decorator';
import { Public } from './public.decorator';
import { clearSessionCookie, setSessionCookie } from './session-cookie';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  private open(req: Request, res: Response, session: NewSession): PublicUser {
    setSessionCookie(req, res, session.token, session.expiresAt);
    return session.user;
  }

  @Public()
  @Post('register')
  async register(@Body(new ZodValidationPipe(RegisterDto)) dto: RegisterDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.open(req, res, await this.auth.register(dto, req.ip ?? 'unknown'));
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body(new ZodValidationPipe(LoginDto)) dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.open(req, res, await this.auth.login(dto, req.ip ?? 'unknown'));
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
