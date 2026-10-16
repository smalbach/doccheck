import type { Destination } from '@doccheck/schemas';
import { DESTINATION_ERROR_KINDS, ERROR_KINDS, injectErrors, type ErrorKind, type ErrorLabel } from './errors';
import { BUYERS, SELLERS } from './catalog';
import { BUYERS_V2, SELLERS_V2 } from './catalog-v2';
import { BUYERS_DESTINATIONS } from './catalog-destinations';
import { generateShipment, TEMPLATES, type GenerateOptions, type SyntheticShipment } from './generate';
import { V2_TEMPLATES } from './render-v2';
import { Rng } from './rng';

export interface DatasetOptions {
  seed: number;
  perCountry: number;
  cleanPerCountry: number;
  /** Set name written to the manifest. */
  version?: string;
  generate?: GenerateOptions;
  /** Destinations, in order; CA and US by default. */
  destinations?: Destination[];
  /** Error kinds to draw from; ERROR_KINDS by default. */
  errorKinds?: ErrorKind[];
}

/** Each destination's own generator stream, so adding one never moves another's shipments. */
const DESTINATION_STREAM: Record<Destination, number> = { CA: 1, US: 2, MX: 3, EU: 4, GB: 5 };

export interface DatasetEntry {
  /** Documents as printed on the PDFs, errors included. This is the extraction target. */
  shipment: SyntheticShipment;
  /** The same shipment before errors were injected. */
  clean: SyntheticShipment;
  labels: ErrorLabel[];
}

/** v1 target from the plan: 200 shipments, 100 per country, 50 clean and 150 with 1–3 errors. */
export const V1: DatasetOptions = { seed: 20261012, perCountry: 100, cleanPerCountry: 25 };

/**
 * v2: formats the extraction prompt was not tuned on. Two new layouts per document (European number
 * and date formats; a numbered-box form), long multi-page line tables from product variants, and
 * parties with accented, non-English names. The v1 layouts stay in the mix (3 of 7 draws) as a
 * control group.
 */
export const V2: DatasetOptions = {
  seed: 20261013,
  perCountry: 30,
  cleanPerCountry: 8,
  version: 'v2',
  generate: {
    sellers: [...SELLERS_V2, ...SELLERS],
    buyers: [...BUYERS_V2, ...BUYERS],
    templates: {
      invoice: [...V2_TEMPLATES, ...V2_TEMPLATES, ...TEMPLATES.invoice],
      packingList: [...V2_TEMPLATES, ...V2_TEMPLATES, ...TEMPLATES.packingList],
      billOfLading: [...V2_TEMPLATES, ...V2_TEMPLATES, ...TEMPLATES.billOfLading],
    },
    variants: { min: 6, max: 16 },
  },
};

export function buildDataset(opts: DatasetOptions = V1): DatasetEntry[] {
  const root = new Rng(opts.seed);
  const entries: DatasetEntry[] = [];
  for (const destination of opts.destinations ?? (['CA', 'US'] as Destination[])) {
    const countryRng = root.fork(DESTINATION_STREAM[destination]);
    // Which positions stay clean is shuffled, so clean and faulty shipments are interleaved.
    const cleanSlots = new Set(countryRng.sample([...Array(opts.perCountry).keys()], opts.cleanPerCountry));
    for (let i = 0; i < opts.perCountry; i++) {
      const id = `${destination}-${String(i + 1).padStart(3, '0')}`;
      const seed = countryRng.int(1, 0x7fffffff);
      const clean = generateShipment(id, destination, seed, opts.generate);
      if (cleanSlots.has(i)) {
        entries.push({ shipment: clean, clean, labels: [] });
        continue;
      }
      const errRng = new Rng(seed ^ 0x5bd1e995);
      const count = errRng.chance(0.4) ? 1 : errRng.chance(0.6) ? 2 : 3;
      const { shipment, labels } = injectErrors(clean, errRng, count, opts.errorKinds);
      entries.push({ shipment, clean, labels });
    }
  }
  return entries;
}

/**
 * v3-destinations: shipments to Mexico, the EU and the UK, with the shared errors plus the
 * destination-specific ones (importer RFC or EORI, ICS2 HS codes, TCA statement on origin, language).
 * Sellers from both catalogs; v1 layouts.
 */
export const V3_DESTINATIONS: DatasetOptions = {
  seed: 20261016,
  perCountry: 30,
  cleanPerCountry: 8,
  version: 'v3-destinations',
  destinations: ['MX', 'EU', 'GB'],
  errorKinds: [...ERROR_KINDS, ...DESTINATION_ERROR_KINDS],
  generate: { sellers: [...SELLERS, ...SELLERS_V2], buyers: BUYERS_DESTINATIONS },
};
