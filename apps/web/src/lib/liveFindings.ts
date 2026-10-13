import type { Finding, FindingPreview, ProgressEvent } from '../api/types';

/** What the agent did with a finding, as the finding card shows it. */
export type FindingEffect = 'kept' | 'dismissed' | 'added';

/**
 * A finding of a validation as its live events built it: found by a rule (or added by the agent), then
 * a regulation quote, then the agent's effect. Its id is the one the stored finding keeps.
 */
export interface LiveFinding {
  id: string;
  ruleId: string;
  severity: Finding['severity'];
  message: string;
  /** Title of the regulation passage quoted for it, once the citations reached it. */
  regulation?: string;
  /** Index of the agent question about it. */
  question?: number;
  effect?: FindingEffect;
  /** The agent's rationale (cut short in events). */
  rationale?: string;
}

const make = (p: FindingPreview, ruleId: string, more: Partial<LiveFinding> = {}): LiveFinding => ({ id: p.id, ruleId, severity: p.severity, message: p.message, ...more });

/** The findings with one changed by id (the same array when there is no such finding). */
function patch(findings: readonly LiveFinding[], id: string, change: Partial<LiveFinding>): readonly LiveFinding[] {
  return findings.some((f) => f.id === id) ? findings.map((f) => (f.id === id ? { ...f, ...change } : f)) : findings;
}

/**
 * The live findings with one more validation event: a rule's `found` previews are added, a citation
 * names the finding's passage, an agent question marks its finding (and an answer sets the effect, or
 * adds the finding the agent found). Pure and idempotent; unrelated events return the same array.
 */
export function applyFindingEvent(findings: readonly LiveFinding[], e: ProgressEvent): readonly LiveFinding[] {
  if (e.kind !== 'validation' || e.status !== 'progress') return findings;
  if (e.stage === 'rules') {
    const fresh = (e.detail.found ?? []).filter((p) => !findings.some((f) => f.id === p.id));
    return fresh.length > 0 && e.detail.rule ? [...findings, ...fresh.map((p) => make(p, e.detail.rule!))] : findings;
  }
  if (e.stage === 'citations') return e.detail.findingId && e.detail.title ? patch(findings, e.detail.findingId, { regulation: e.detail.title }) : findings;
  if (e.stage !== 'agent' || !e.detail.findingId || !e.detail.index) return findings;
  const { findingId, index, answer, added, ruleId } = e.detail;
  if (added && !findings.some((f) => f.id === added.id)) return [...findings, make(added, ruleId ?? '', { question: index, effect: 'added', rationale: answer?.rationale })];
  const effect = answer?.effect === 'none' ? undefined : answer?.effect;
  return patch(findings, findingId, { question: index, ...(effect ? { effect } : {}), ...(answer?.rationale ? { rationale: answer.rationale } : {}) });
}

/** The findings the agent dismissed: the stored run no longer has them, so the card lists them apart. */
export const dismissedFindings = (findings: readonly LiveFinding[]): LiveFinding[] => findings.filter((f) => f.effect === 'dismissed');

/** DOM id of a finding's card (live or stored), for the agent panel to scroll to it. */
export const findingAnchorId = (id: string): string => `finding-card-${id}`;
