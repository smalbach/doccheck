import type { Request, Response } from 'express';

export const SESSION_COOKIE = 'doccheck_session';
export const SESSION_DAYS = 30;

/** The session token from the Cookie header, if any (no cookie-parser needed for one cookie). */
export function readSessionToken(req: Request): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === SESSION_COOKIE) return decodeURIComponent(value.join('='));
  }
  return undefined;
}

/** HttpOnly, SameSite=Lax (no cross-site POSTs carry it), Secure when the request came over HTTPS (e.g. through the tunnel). */
export function setSessionCookie(req: Request, res: Response, token: string, expires: Date): void {
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: req.secure, path: '/', expires });
}

export function clearSessionCookie(req: Request, res: Response): void {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', secure: req.secure, path: '/' });
}
