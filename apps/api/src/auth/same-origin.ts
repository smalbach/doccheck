import type { NextFunction, Request, Response } from 'express';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence on top of the SameSite=Lax cookie: a state-changing request sent by a browser must
 * come from this origin. Browsers send Origin (or at least Referer) on those requests; scripts and
 * curl send neither and are allowed, since they cannot ride on a visitor's cookie.
 */
export function sameOriginGuard(req: Request, res: Response, next: NextFunction) {
  if (SAFE.has(req.method)) return next();
  const source = req.headers.origin ?? req.headers.referer;
  if (!source) return next();
  let host: string;
  try {
    host = new URL(source).host;
  } catch {
    host = '';
  }
  const expected = req.get('x-forwarded-host') ?? req.get('host');
  if (host && host === expected) return next();
  res.status(403).json({ statusCode: 403, message: 'Cross-origin request refused' });
}
