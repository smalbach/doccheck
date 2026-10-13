import { createParamDecorator, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { AuthedRequest, PublicUser } from './auth.types';

/** The signed-in user, set by AuthGuard. */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): PublicUser => {
  const user = ctx.switchToHttp().getRequest<AuthedRequest>().user;
  if (!user) throw new UnauthorizedException();
  return user;
});
