import type { Destination } from '@doccheck/schemas';
import { injectErrors, type ErrorLabel } from './errors';
import { generateShipment, type SyntheticShipment } from './generate';
import { Rng } from './rng';

export interface DatasetOptions {
  seed: number;
  perCountry: number;
  cleanPerCountry: number;
}

export interface DatasetEntry {
  /** Documents as printed on the PDFs, errors included. This is the extraction target. */
  shipment: SyntheticShipment;
  /** The same shipment before errors were injected. */
  clean: SyntheticShipment;
  labels: ErrorLabel[];
}

/** v1 target from the plan: 200 shipments, 100 per country, 50 clean and 150 with 1–3 errors. */
export const V1: DatasetOptions = { seed: 20261012, perCountry: 100, cleanPerCountry: 25 };

export function buildDataset(opts: DatasetOptions = V1): DatasetEntry[] {
  const root = new Rng(opts.seed);
  const entries: DatasetEntry[] = [];
  for (const destination of ['CA', 'US'] as Destination[]) {
    const countryRng = root.fork(destination === 'CA' ? 1 : 2);
    // Which positions stay clean is shuffled, so clean and faulty shipments are interleaved.
    const cleanSlots = new Set(countryRng.sample([...Array(opts.perCountry).keys()], opts.cleanPerCountry));
    for (let i = 0; i < opts.perCountry; i++) {
      const id = `${destination}-${String(i + 1).padStart(3, '0')}`;
      const seed = countryRng.int(1, 0x7fffffff);
      const clean = generateShipment(id, destination, seed);
      if (cleanSlots.has(i)) {
        entries.push({ shipment: clean, clean, labels: [] });
        continue;
      }
      const errRng = new Rng(seed ^ 0x5bd1e995);
      const count = errRng.chance(0.4) ? 1 : errRng.chance(0.6) ? 2 : 3;
      const { shipment, labels } = injectErrors(clean, errRng, count);
      entries.push({ shipment, clean, labels });
    }
  }
  return entries;
}
