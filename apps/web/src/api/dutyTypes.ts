// The duty estimate's contract, from @doccheck/duties (types only: the package reads files on the server).
import type { CusmaElement, DutyEstimate, EntryDraft } from '@doccheck/duties';

export type { Cbp7501Draft, CbsaCadDraft, CusmaElement, DutyEstimate, DutyFinding, DutyFindingCode, DutyInputs, EntryDraft, LineEstimate } from '@doccheck/duties';

/** GET /shipments/:id/duties */
export interface DutiesView {
  estimate: DutyEstimate;
  entry?: EntryDraft;
  inputsUpdatedAt?: string;
}

/** The nine CUSMA minimum data elements, in the order of Annex 5-A (same list as the server's). */
export const CUSMA_ELEMENTS: readonly CusmaElement[] = ['certifierRole', 'certifier', 'exporter', 'producer', 'importer', 'descriptionAndHs', 'originCriterion', 'blanketPeriod', 'signatureAndDate'];

