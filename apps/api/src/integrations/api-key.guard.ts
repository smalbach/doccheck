import { ForbiddenException, HttpException, HttpStatus, Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import type { OrgRequest } from '../orgs/org.types';
import { PERMISSION, type OrgPermission } from '../orgs/permissions';
import type { ApiRequest } from './account';
import { ApiKeysService } from './api-keys';
import { RateLimiter } from './rate-limiter';

/** The key from "Authorization: Bearer dck_..." or "X-API-Key: dck_...". */
export function readApiKey(req: Request): string | undefined {
  const auth = req.headers.authorization;
  if (auth && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim();
  const header = req.headers['x-api-key'];
  return typeof header === 'string' ? header.trim() : undefined;
}

/**
 * Public API authentication: a live API key, within its requests per minute, whose scopes give the
 * permission the route names with @Permission() (as OrgGuard does for members: without one, data.read
 * to read and shipment.write to change). The request then acts in the key's organization: req.org is
 * set for the shipment guard and the audit log. Sets RateLimit-* headers on every answer and
 * Retry-After on a 429. Session cookies are not accepted here, so a browser cannot be made to call
 * the API on a user's behalf.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly keys: ApiKeysService,
    private readonly limiter: RateLimiter,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & ApiRequest & OrgRequest>();
    const res = context.switchToHttp().getResponse<Response>();
    const key = readApiKey(req);
    if (!key) throw new UnauthorizedException('Send an API key: Authorization: Bearer dck_...');
    const principal = await this.keys.authenticate(key);
    if (!principal) throw new UnauthorizedException('The API key is not valid or was revoked');
    const rate = await this.limiter.take(principal.keyId, principal.rateLimit);
    res.setHeader('RateLimit-Limit', String(rate.limit));
    res.setHeader('RateLimit-Remaining', String(rate.remaining));
    res.setHeader('RateLimit-Reset', String(rate.resetSeconds));
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.resetSeconds));
      throw new HttpException({ statusCode: 429, message: `Rate limit of ${rate.limit} requests per minute reached; retry in ${rate.resetSeconds} s` }, HttpStatus.TOO_MANY_REQUESTS);
    }
    const needed =
      this.reflector.getAllAndOverride<OrgPermission>(PERMISSION, [context.getHandler(), context.getClass()]) ?? (req.method === 'GET' || req.method === 'HEAD' ? 'data.read' : 'shipment.write');
    if (!principal.permissions.includes(needed)) throw new ForbiddenException(`This API key's scopes (${principal.scopes.join(', ')}) do not allow this (${needed})`);
    const { rateLimit: _, ...rest } = principal;
    req.principal = rest;
    // Acts as a member that can do what the scopes allow; never a client (who sees only shared shipments).
    req.org = { id: principal.orgId, name: principal.orgName, personal: false, role: principal.scopes.includes('write') ? 'analyst' : 'viewer' };
    return true;
  }
}
