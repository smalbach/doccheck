import type { Finding } from '../../api/types';
import { countBySeverity } from '../../lib/countBySeverity';
import { pluralize } from '../../lib/pluralize';

/** "3 findings: 1 high, 2 medium". */
export function FindingsSummary({ findings }: { findings: readonly Finding[] }) {
  const counts = countBySeverity(findings);
  return (
    <p className="findings-summary">
      <strong>{pluralize(findings.length, 'finding')}</strong>
      {counts.map((c) => (
        <span key={c.severity} className={`severity-count severity-${c.severity}`}>
          {c.count} {c.severity.toLowerCase()}
        </span>
      ))}
    </p>
  );
}
