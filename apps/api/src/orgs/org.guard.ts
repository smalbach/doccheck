import { ForbiddenException, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AuthedRequest } from '../auth/auth.types';
import { IS_PUBLIC } from '../auth/public.decorator';
import type { OrgRequest } from './org.types';
import { OrgsRepository } from './orgs.repository';
import { can, NO_ORG, PERMISSION, type OrgPermission } from './permissions';

/**
 * Global, after AuthGuard: sets the organization the request acts in (the session's, see
 * POST /orgs/:id/switch) and checks the route's permission for the member's role there. A route
 * without @Permission() needs data.read to read and shipment.write to change anything, so a new route
 * is closed to viewers and clients until it says otherwise.
 */
@Injectable()
export class OrgGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly orgs: OrgsRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<Request & AuthedRequest & OrgRequest>();
    const targets = [context.getHandler(), context.getClass()];
    const user = req.user;
    if (!user) return true; // AuthGuard has already refused a route that needs a session.
    let org = await this.orgs.activeMembership(user.id, req.sessionOrgId ?? null);
    if (!org) {
      // Removed from every organization: they start over in a new personal one.
      await this.orgs.create(user.id, user.name, true);
      org = await this.orgs.activeMembership(user.id, null);
    }
    if (org) req.org = org;
    if (this.reflector.getAllAndOverride<boolean>(NO_ORG, targets) || this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    const needed =
      this.reflector.getAllAndOverride<OrgPermission>(PERMISSION, targets) ?? (req.method === 'GET' || req.method === 'HEAD' ? 'data.read' : 'shipment.write');
    if (!can(org?.role, needed)) throw new ForbiddenException(`Your role in ${org?.name ?? 'this organization'} cannot do this (${needed})`);
    return true;
  }
}
