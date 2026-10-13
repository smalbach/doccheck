import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { raw } from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppModule } from './app.module';
import { sameOriginGuard } from './auth/same-origin';
import { isDemo, readOnlyGuard } from './demo/demo-mode';
import { loadEnv } from './env';
import { trustProxySetting } from './trust-proxy';

async function bootstrap() {
  loadEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableShutdownHooks();
  // A proxy terminates HTTPS (ngrok or Caddy on this machine, or a host's edge: TRUST_PROXY=1): trust
  // its X-Forwarded-* so the session cookie is marked Secure there and client addresses are right
  // for the sign-in and sign-up throttles.
  app.set('trust proxy', trustProxySetting());
  // Received mail arrives raw (up to 30 MB with attachments); every other body is JSON.
  app.use('/mail/inbound', raw({ type: () => true, limit: '30mb' }));
  app.use(sameOriginGuard);
  if (isDemo()) {
    app.use(readOnlyGuard);
    Logger.log('Read-only demo: uploads, edits and deletes are disabled; the model runs from its cache', 'Bootstrap');
  }
  // The built web app (npm run build -w @doccheck/web) is served from the same origin.
  const web = resolve(__dirname, '../../web/dist');
  // index.html is revalidated on every load so a new build is picked up; hashed assets cache normally.
  if (existsSync(web)) {
    app.useStaticAssets(web, {
      index: 'index.html',
      setHeaders: (res, path) => {
        if (path.endsWith('.html')) res.setHeader('cache-control', 'no-cache');
      },
    });
  }
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  Logger.log(`DocCheck API listening on http://localhost:${port}`, 'Bootstrap');
}
void bootstrap();
