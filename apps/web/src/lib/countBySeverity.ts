import type { Finding } from '../api/types';
import { SEVERITY_ORDER, type Severity } from '../constants/severity';

/** Number of findings per severity, most severe first, without the empty ones. */
export function countBySeverity(findings: readonly Finding[]): { severity: Severity; count: number }[] {
  return SEVERITY_ORDER.map((severity) => ({ severity, count: findings.filter((f) => f.severity === severity).length })).filter((s) => s.count > 0);
}
