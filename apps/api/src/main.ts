import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppModule } from './app.module';
import { loadEnv } from './env';

async function bootstrap() {
  loadEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableShutdownHooks();
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
