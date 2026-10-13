import { Body, Controller, Delete, Get, HttpCode, Patch, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ChangePasswordDto, DeleteAccountDto, LoginDto, RegisterDto, UpdateProfileDto } from './auth.dto';
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
    return this.open(req, res, await this.auth.register(dto));
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body(new ZodValidationPipe(LoginDto)) dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.open(req, res, await this.auth.login(dto, req.ip ?? 'unknown'));
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
