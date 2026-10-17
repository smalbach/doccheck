/**
 * The supplier score, documented on the scorecard page (and in docs/ANALYTICS.md) exactly as here:
 *
 *   score = 100 × (0.5 × first-pass + 0.3 × correction + 0.2 × responsiveness) / (sum of the weights present)
 *
 * - first-pass: share of the supplier's validated shipments with no finding on their first validation.
 * - correction: share of the findings asked of the supplier (correction requests, "waiting for the
 *   supplier") that a later validation no longer had.
 * - responsiveness: 1 − median hours to the first reply ÷ 120 (a reply within the hour is ~1, five
 *   days or more is 0); requests never answered count as 120 hours.
 *
 * A component without data (nothing was ever asked) is left out and the weights of the others are
 * rescaled, so a supplier is not punished for never having needed a correction. Integer arithmetic
 * on counts; the score is rounded to a whole number.
 */
export const SCORE_WEIGHTS = { firstPass: 0.5, correction: 0.3, responsiveness: 0.2 } as const;
export const RESPONSE_HORIZON_HOURS = 120;
/** Fewer validated shipments than this and the score is marked as based on little data. */
export const MIN_SHIPMENTS = 3;

export interface ScoreInput {
  validatedShipments: number;
  cleanFirstPass: number;
  requestedFindings: number;
  correctedFindings: number;
  /** Hours from each request to its first reply; null for a request never answered. */
  responseHours: (number | null)[];
}

export interface Score {
  score: number | null;
  components: { firstPass: number | null; correction: number | null; responsiveness: number | null };
  lowData: boolean;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function supplierScore(i: ScoreInput): Score {
  const firstPass = i.validatedShipments > 0 ? i.cleanFirstPass / i.validatedShipments : null;
  const correction = i.requestedFindings > 0 ? Math.min(1, i.correctedFindings / i.requestedFindings) : null;
  const hours = median(i.responseHours.map((h) => (h === null ? RESPONSE_HORIZON_HOURS : Math.min(h, RESPONSE_HORIZON_HOURS))));
  const responsiveness = hours === null ? null : Math.max(0, 1 - hours / RESPONSE_HORIZON_HOURS);
  const parts = [
    [firstPass, SCORE_WEIGHTS.firstPass],
    [correction, SCORE_WEIGHTS.correction],
    [responsiveness, SCORE_WEIGHTS.responsiveness],
  ].filter((p): p is [number, number] => p[0] !== null);
  const weight = parts.reduce((s, [, w]) => s + w, 0);
  const score = weight > 0 ? Math.round((100 * parts.reduce((s, [v, w]) => s + v * w, 0)) / weight) : null;
  return { score, components: { firstPass, correction, responsiveness }, lowData: i.validatedShipments < MIN_SHIPMENTS };
}
