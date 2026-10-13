import { ForbiddenException, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { AuthedRequest } from './auth.types';

/** Admin-only routes: checked on the server for every request (AuthGuard has already set the user). */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest<AuthedRequest>().user;
    if (user?.role !== 'admin') throw new ForbiddenException('Only admins can do this');
    return true;
  }
}
