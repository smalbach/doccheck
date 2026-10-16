import { createParamDecorator, ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { OrgContext, OrgRequest } from './org.types';

/** The organization the request acts in, set by OrgGuard. */
export const CurrentOrg = createParamDecorator((_: unknown, ctx: ExecutionContext): OrgContext => {
  const org = ctx.switchToHttp().getRequest<OrgRequest>().org;
  if (!org) throw new ForbiddenException('No organization');
  return org;
});
