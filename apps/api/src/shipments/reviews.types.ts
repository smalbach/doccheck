import type { Finding } from '@doccheck/schemas';

/**
 * What the user decided about a finding. open: nothing yet (or a decision undone); waiting_supplier:
 * a corrected document was asked for; accepted: the risk is taken; false_positive: the finding is
 * wrong. A finding that disappears from the next validation run is resolved (not a stored status).
 */
export const REVIEW_STATUSES = ['open', 'waiting_supplier', 'accepted', 'false_positive'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** Statuses that close a finding; they need a note saying why. */
export const CLOSING_STATUSES: readonly ReviewStatus[] = ['accepted', 'false_positive'];

export interface FindingReview {
  status: ReviewStatus;
  note?: string;
  userName?: string;
  at: string;
}

export type FingerprintedFinding = Finding & { fingerprint: string };

export interface ReviewedFinding extends FingerprintedFinding {
  /** The latest decision; absent while nobody decided anything. */
  review?: FindingReview;
  /** Every decision, newest first. */
  history: FindingReview[];
  /** Not in the previous validation run. */
  isNew: boolean;
}
