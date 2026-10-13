import { z } from 'zod';
import { Address, CountryCode, Party } from './common';

/** Importer Security Filing (10+2): the 10 importer data elements. US ocean only. */
export const Isf = z.object({
  seller: Party,
  buyer: Party,
  importerOfRecordNumber: z.string(),
  consigneeNumber: z.string(),
  manufacturer: Party,
  shipToParty: Party,
  countryOfOrigin: CountryCode,
  htsCode: z.string(),
  containerStuffingLocation: Address,
  consolidator: Party,
});
export type Isf = z.infer<typeof Isf>;
