import { Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthService, hashToken } from './auth.service';
import type { AuthedRequest } from './auth.types';
import { IS_PUBLIC } from './public.decorator';
import { readSessionToken } from './session-cookie';

/** Global: every route needs a live session unless marked @Public(). Public routes still see the user when there is one. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & AuthedRequest>();
    const token = readSessionToken(req);
    const user = token ? await this.auth.sessionUser(token) : null;
    if (user && token) {
      req.user = user;
      req.sessionTokenHash = hashToken(token);
    }
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()]);
    if (!isPublic && !user) throw new UnauthorizedException('Sign in to continue');
    return true;
  }
}
