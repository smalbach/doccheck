import type { Finding, RuleDefinition, ShipmentDocument } from '../../api/types';
import { Tag } from '../../components/ui/Tag';
import type { ViewerTarget } from '../pdf/types';
import { EvidenceItem } from './EvidenceItem';
import { RegulationQuote } from './RegulationQuote';

export interface FindingCardProps {
  finding: Finding;
  rule?: RuleDefinition;
  documents: ReadonlyMap<string, ShipmentDocument>;
  onOpen: (target: ViewerTarget) => void;
}

export function FindingCard({ finding, rule, documents, onOpen }: FindingCardProps) {
  return (
    <article className={`finding finding-${finding.severity}`}>
      <header>
        <span className={`severity severity-${finding.severity}`}>{finding.severity}</span>
        <span className="rule-id">{finding.ruleId}</span>
        {rule && <span className="rule-title">{rule.title}</span>}
        {finding.decidedBy === 'AGENT' && <Tag tone="accent">agent</Tag>}
      </header>
      <p>{finding.message}</p>
      <ul className="evidence">
        {finding.evidence.map((e, i) => (
          <EvidenceItem key={`${e.documentId}-${e.field}-${i}`} evidence={e} doc={documents.get(e.documentId)} onOpen={onOpen} />
        ))}
      </ul>
      {finding.agentRationale && (
        <p className="rationale">
          <strong>Agent:</strong> {finding.agentRationale}
        </p>
      )}
      {finding.suggestedFix && <p className="fix">{finding.suggestedFix}</p>}
      {finding.regulation && <RegulationQuote regulation={finding.regulation} />}
    </article>
  );
}
