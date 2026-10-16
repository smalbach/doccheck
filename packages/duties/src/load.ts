import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { DutyTables } from './tables';

const FILES: Record<keyof DutyTables, string> = {
  usHts: 'us-hts.json',
  caTariff: 'ca-tariff.json',
  fxCa: 'fx-ca.json',
  fxUs: 'fx-us.json',
  usAdditional: 'us-additional-duties.json',
  caAdditional: 'ca-surtaxes.json',
  usFees: 'us-fees.json',
  caTaxes: 'ca-taxes.json',
  adcvd: 'adcvd-cases.json',
  fta: 'fta.json',
};

/** data/duties: DUTY_DATA_DIR, then ./data/duties from the working directory, then next to this package. */
export function dutyDataDir(): string {
  const dirs = [process.env.DUTY_DATA_DIR, resolve(process.cwd(), 'data/duties'), resolve(__dirname, '../../../data/duties')].filter((d): d is string => !!d);
  const found = dirs.find((d) => existsSync(resolve(d, FILES.fta)));
  if (!found) throw new Error(`Duty tables not found (looked in ${dirs.join(', ')}). Set DUTY_DATA_DIR.`);
  return found;
}

/** A table as `name` or, failing that, `name.gz`; a plain file wins so a hand-edited copy can override a fetched one. */
function readTable(dir: string, name: string): unknown {
  const plain = resolve(dir, name);
  if (existsSync(plain)) return JSON.parse(readFileSync(plain, 'utf8'));
  const gz = `${plain}.gz`;
  if (existsSync(gz)) return JSON.parse(gunzipSync(readFileSync(gz)).toString('utf8'));
  throw new Error(`Duty table ${name} is missing in ${dir}: run node scripts/fetch-duty-data.mjs`);
}

const cache = new Map<string, DutyTables>();

/** Loads every table once per directory. `reload` drops the cached copy (after a fetch or an edit). */
export function loadDutyTables(dir = dutyDataDir(), reload = false): DutyTables {
  if (!reload && cache.has(dir)) return cache.get(dir)!;
  const tables = Object.fromEntries(Object.entries(FILES).map(([key, file]) => [key, readTable(dir, file)])) as unknown as DutyTables;
  cache.set(dir, tables);
  return tables;
}
