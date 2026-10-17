#!/usr/bin/env node
/**
 * Stages the built API and web app in apps/desktop/server, the folder the desktop app ships in its
 * resources (electron-builder extraResources). Run `npm run build` at the repository root first.
 *
 * The layout mirrors the repository so every path the API resolves from __dirname still works:
 *   server/apps/api/{dist,migrations}   the API
 *   server/apps/web/dist                the web app it serves
 *   server/node_modules/@doccheck/*     the workspace packages (dist + package.json), copied, not linked
 *   server/node_modules/*               their third-party dependencies, installed for this platform
 *   server/data, server/eval/reports    regulation index, tariff, duties, demo samples, eval reports
 *
 *   node scripts/stage-server.mjs
 */
import { execSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(desktop, '../..');
const out = join(desktop, 'server');
// Build tools the API never loads.
const SKIP_PACKAGES = new Set(['synth', 'client']);

const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const copy = async (from, to) => {
  if (!existsSync(from)) return false;
  await cp(from, to, { recursive: true });
  return true;
};

for (const required of ['apps/api/dist/main.js', 'apps/web/dist/index.html']) {
  if (!existsSync(join(repo, required))) throw new Error(`Missing ${required}: run npm run build at the repository root first`);
}

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

const api = await readJson(join(repo, 'apps/api/package.json'));
await copy(join(repo, 'apps/api/dist'), join(out, 'apps/api/dist'));
await copy(join(repo, 'apps/api/migrations'), join(out, 'apps/api/migrations'));
await writeFile(join(out, 'apps/api/package.json'), JSON.stringify({ name: api.name, version: api.version, private: true }, null, 2));
await copy(join(repo, 'apps/web/dist'), join(out, 'apps/web/dist'));

// Third-party dependencies of the API and every package it ships, the API's versions first.
const deps = {};
const addDeps = (pkg) => {
  for (const [name, version] of Object.entries(pkg.dependencies ?? {})) {
    if (!name.startsWith('@doccheck/') && !(name in deps)) deps[name] = version;
  }
};
addDeps(api);
for (const dir of (await readdir(join(repo, 'packages'))).sort()) {
  if (SKIP_PACKAGES.has(dir)) continue;
  const pkgDir = join(repo, 'packages', dir);
  const pkg = await readJson(join(pkgDir, 'package.json'));
  if (!existsSync(join(pkgDir, 'dist'))) throw new Error(`Missing packages/${dir}/dist: run npm run build first`);
  const target = join(out, 'node_modules', pkg.name);
  await copy(join(pkgDir, 'dist'), join(target, 'dist'));
  await copy(join(pkgDir, 'fixtures'), join(target, 'fixtures'));
  await writeFile(join(target, 'package.json'), JSON.stringify(pkg, null, 2));
  addDeps(pkg);
}

for (const dir of ['data/corpus', 'data/duties', 'data/tariff', 'data/demo', 'data/screening', 'eval/reports']) {
  if (await copy(join(repo, dir), join(out, dir))) console.log(`· ${dir}`);
}
await copy(join(repo, 'scripts/corpus-intl.mjs'), join(out, 'scripts/corpus-intl.mjs'));

await writeFile(join(out, 'package.json'), JSON.stringify({ name: 'doccheck-server', version: api.version, private: true, dependencies: deps }, null, 2));
console.log(`· Installing ${Object.keys(deps).length} dependencies for ${process.platform}-${process.arch} …`);
const doccheck = join(out, 'node_modules/@doccheck');
const saved = join(out, '.doccheck-packages');
// npm install prunes folders it did not install: keep the workspace packages aside meanwhile.
await cp(doccheck, saved, { recursive: true });
execSync('npm install --omit=dev --no-package-lock --no-audit --no-fund', { cwd: out, stdio: 'inherit' });
await cp(saved, doccheck, { recursive: true });
await rm(saved, { recursive: true, force: true });
console.log(`✓ Staged ${out}`);
