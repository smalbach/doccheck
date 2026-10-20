import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { static as serveStatic, type NextFunction, type Request, type Response } from 'express';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isDemo } from './demo/demo-mode';

/** Where the app is when the product page holds /: the web build's own index.html. */
const APP_PATH = '/index.html';

/**
 * Serves the product page (apps/landing, the same page GitHub Pages publishes) at / and moves the
 * web app to /index.html. On by default in the read-only demo, so its visitors see what DocCheck is
 * and a "Try the demo" button; SERVE_LANDING=true or false overrides that. The page is given
 * <meta name="doccheck-app">, which shows the button and forwards links into the app (/#/app,
 * /#/portal?t=… in emails) to /index.html. Its screenshots come from apps/landing/screenshots in the
 * Docker image, else from docs/screenshots of the repository.
 */
export function serveLanding(app: NestExpressApplication) {
  const setting = process.env.SERVE_LANDING;
  if (setting === 'false' || (setting !== 'true' && !isDemo())) return;
  const dir = resolve(__dirname, '../../landing');
  const page = resolve(dir, 'index.html');
  if (!existsSync(page)) {
    Logger.warn(`No product page at ${page}: / shows the web app`, 'Bootstrap');
    return;
  }
  const html = readFileSync(page, 'utf8').replace('<head>', `<head>\n<meta name="doccheck-app" content="${APP_PATH}">`);
  const files: Record<string, string> = { '/icon.svg': resolve(dir, 'icon.svg'), '/apple-touch-icon.png': resolve(dir, 'apple-touch-icon.png'), '/flow.js': resolve(dir, 'flow.js') };
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path === '/') {
      res.setHeader('cache-control', 'no-cache');
      res.type('html').send(html);
      return;
    }
    const file = files[req.path];
    if (file && existsSync(file)) return res.sendFile(file);
    next();
  });
  const shots = [resolve(dir, 'screenshots'), resolve(__dirname, '../../../docs/screenshots')].find((d) => existsSync(d));
  if (shots) app.use('/screenshots', serveStatic(shots, { index: false, maxAge: '1d' }));
  Logger.log(`Product page at /, the app at ${APP_PATH}`, 'Bootstrap');
}
