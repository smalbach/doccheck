import type { NextFunction, Request, Response } from 'express';

/**
 * Read-only public demo (DEMO_READONLY=true): visitors can open the curated samples, validate them
 * and read everything, but cannot upload, edit or delete. The model runs from its cached answers
 * only (no Ollama, no GPU), so the demo can be hosted on a small server.
 */
export const isDemo = (env: NodeJS.ProcessEnv = process.env) => env.DEMO_READONLY === 'true';

// Accounts work as usual in the demo (sign up, sign in, profile, password, forgotten password); data
// stays read-only.
const ALLOWED_WRITES = [/^\/auth\/(register|login|logout|me|me\/language|password|forgot-password|reset-password)$/, /^\/demo\/samples\/[\w-]+$/, /^\/shipments\/[0-9a-f-]{36}\/validate$/i, /^\/shipments\/[0-9a-f-]{36}\/duties\/preview$/i];

export function readOnlyGuard(req: Request, res: Response, next: NextFunction) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  if ((req.method === 'POST' || req.method === 'PATCH') && ALLOWED_WRITES.some((re) => re.test(req.path))) return next();
  // Visitors can always delete their own account.
  if (req.method === 'DELETE' && req.path === '/auth/me') return next();
  res.status(403).json({ statusCode: 403, message: 'This is a read-only demo: load a sample shipment and validate it.' });
}
