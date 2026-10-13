import { Injectable, NotFoundException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthedRequest } from '../auth/auth.types';
import { ShipmentsRepository } from './shipments.repository';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Routes with a shipment :id answer 404 unless the shipment belongs to the signed-in user, the same
 * answer as for a shipment that does not exist, so ids of other users' shipments are not confirmed.
 */
@Injectable()
export class ShipmentOwnerGuard implements CanActivate {
  constructor(private readonly repo: ShipmentsRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & AuthedRequest>();
    const id = req.params.id;
    if (typeof id !== 'string') return true;
    if (!req.user || !UUID.test(id) || !(await this.repo.isOwner(id, req.user.id))) throw new NotFoundException(`Shipment ${id} not found`);
    return true;
  }
}
