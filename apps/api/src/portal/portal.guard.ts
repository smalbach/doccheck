import { createParamDecorator, HttpException, HttpStatus, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PortalThrottle } from './portal-throttle';
import { PortalService, type PortalAccess } from './portal.service';

type PortalRequest = Request & { portal?: PortalAccess };

/**
 * The supplier portal's only way in: the link's token in the X-Portal-Token header (never a cookie, so
 * no other site can make a supplier's browser use it). Runs before the body is read, so an upload
 * without a working link is refused before its files are. Throttled per client address.
 */
@Injectable()
export class PortalGuard implements CanActivate {
  constructor(
    private readonly portal: PortalService,
    private readonly throttle: PortalThrottle,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest<PortalRequest>();
    const ip = req.ip ?? req.socket.remoteAddress ?? '';
    const wait = this.throttle.request(ip);
    if (wait) {
      http.getResponse<Response>().setHeader('retry-after', String(wait));
      throw new HttpException({ statusCode: 429, message: 'Too many requests: try again in a few minutes', reason: 'throttled' }, HttpStatus.TOO_MANY_REQUESTS);
    }
    try {
      req.portal = await this.portal.authenticate(req.headers['x-portal-token'], ip, String(req.headers['user-agent'] ?? ''));
    } catch (err) {
      this.throttle.denied(ip);
      throw err;
    }
    return true;
  }
}

/** The link and request PortalGuard found. */
export const Portal = createParamDecorator((_: unknown, ctx: ExecutionContext): PortalAccess => ctx.switchToHttp().getRequest<PortalRequest>().portal!);
