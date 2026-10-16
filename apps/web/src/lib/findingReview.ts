import type { ReviewStatus, ValidationFinding } from '../api/types';
import type { MessageKey } from '../i18n/keys';

/** The finding's current status: its latest decision, or open. */
export const reviewStatus = (f: ValidationFinding): ReviewStatus => f.review?.status ?? 'open';

/** Accepted as a risk or marked a false positive: it needs nothing more. */
export const isClosed = (f: ValidationFinding) => {
  const s = reviewStatus(f);
  return s === 'accepted' || s === 'false_positive';
};

/** Statuses that need a note saying why. */
export const NEEDS_NOTE: readonly ReviewStatus[] = ['accepted', 'false_positive'];

export type FindingFilter = 'open' | 'waiting' | 'closed' | 'all';

export const matchesFilter = (f: ValidationFinding, filter: FindingFilter) =>
  filter === 'all' || (filter === 'waiting' ? reviewStatus(f) === 'waiting_supplier' : (filter === 'closed') === isClosed(f));

const GUIDED = new Set(['C1', 'C2', 'U1', 'X1', 'X2', 'X3', 'X4', 'X5', 'X6', 'X7', 'X8', 'X9', 'X10', 'X11', 'X12', 'A1']);

/** The translated one-line problem or what-to-do of a rule, when there is one. */
export function ruleGuideKey(ruleId: string, part: 'problem' | 'action'): MessageKey | undefined {
  return GUIDED.has(ruleId) ? (`ruleGuide.${ruleId}.${part}` as MessageKey) : undefined;
}

/** "lines[2].quantity.value" → "/lines/2/quantity/value": the pointer the correction form uses. */
export function evidencePointer(field: string): string {
  return field
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean)
    .map((s) => `/${s.replace(/~/g, '~0').replace(/\//g, '~1')}`)
    .join('');
}
