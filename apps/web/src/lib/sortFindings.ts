import type { Finding } from '../api/types';
import { SEVERITY_ORDER } from '../constants/severity';
import { compareRuleIds } from './compareRuleIds';

/** Most severe first, then by rule (stored findings, or the live ones of a running validation). */
export function sortFindings<T extends Pick<Finding, 'severity' | 'ruleId'>>(findings: readonly T[]): T[] {
  return [...findings].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || compareRuleIds(a.ruleId, b.ruleId));
}
