import { ForbiddenException, HttpException, HttpStatus, Injectable, SetMetadata, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import type { ApiRequest, ApiScope } from './account';
import { ApiKeysService } from './api-keys';
import { RateLimiter } from './rate-limiter';

export const API_SCOPE = 'doccheck:api-scope';
/** The scope a /api/v1 route needs: read for GETs, write for anything that changes data. */
export const RequireScope = (scope: ApiScope) => SetMetadata(API_SCOPE, scope);

/** The key from "Authorization: Bearer dck_..." or "X-API-Key: dck_...". */
export function readApiKey(req: Request): string | undefined {
  const auth = req.headers.authorization;
  if (auth && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim();
  const header = req.headers['x-api-key'];
  return typeof header === 'string' ? header.trim() : undefined;
}

/**
 * Public API authentication: a live API key with the route's scope, within the key's requests per
 * minute. Sets RateLimit-* headers on every answer and Retry-After on a 429. Session cookies are not
 * accepted here, so a browser cannot be made to call the API on a user's behalf.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly keys: ApiKeysService,
    private readonly limiter: RateLimiter,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & ApiRequest>();
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
    const needed = this.reflector.getAllAndOverride<ApiScope>(API_SCOPE, [context.getHandler(), context.getClass()]) ?? 'write';
    if (!principal.scopes.includes(needed)) throw new ForbiddenException(`This API key lacks the "${needed}" scope`);
    const { rateLimit: _, ...rest } = principal;
    req.principal = rest;
    return true;
  }
}
