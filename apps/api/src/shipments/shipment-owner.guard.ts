import { Injectable, NotFoundException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthedRequest } from '../auth/auth.types';
import type { OrgRequest } from '../orgs/org.types';
import { OrgsRepository } from '../orgs/orgs.repository';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Routes with a shipment :id answer 404 unless the shipment belongs to the organization the request
 * acts in (and, for a client, is shared with them): the same answer as for a shipment that does not
 * exist, so ids of other organizations' shipments are not confirmed. Runs after OrgGuard.
 */
@Injectable()
export class ShipmentOwnerGuard implements CanActivate {
  constructor(private readonly orgs: OrgsRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & AuthedRequest & OrgRequest>();
    const id = req.params.id;
    if (typeof id !== 'string') return true;
    if (!req.user || !req.org || !UUID.test(id) || !(await this.orgs.canSeeShipment(id, req.org, req.user.id))) throw new NotFoundException(`Shipment ${id} not found`);
    return true;
  }
}
