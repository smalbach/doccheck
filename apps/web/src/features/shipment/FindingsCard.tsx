import type { RuleDefinition, ShipmentDocument, Validation } from '../../api/types';
import { Banner } from '../../components/ui/Banner';
import { Card } from '../../components/ui/Card';
import { formatDateTime } from '../../lib/formatDateTime';
import { pluralize } from '../../lib/pluralize';
import { sortFindings } from '../../lib/sortFindings';
import type { ViewerTarget } from '../pdf/types';
import { AgentDecisions } from './AgentDecisions';
import { FindingCard } from './FindingCard';
import { FindingsSummary } from './FindingsSummary';

export interface FindingsCardProps {
  validation?: Validation;
  rules: Readonly<Record<string, RuleDefinition>>;
  documents: ReadonlyMap<string, ShipmentDocument>;
  onOpen: (target: ViewerTarget) => void;
}

export function FindingsCard({ validation, rules, documents, onOpen }: FindingsCardProps) {
  const aside = validation && (
    <span className="muted small">
      {formatDateTime(validation.createdAt)} · {pluralize(validation.ran.length, 'rule')} ran
    </span>
  );
  return (
    <Card title="Findings" aside={aside} className="findings">
      {!validation ? (
        <p className="muted">Upload the documents and validate to see findings.</p>
      ) : validation.findings.length === 0 ? (
        <Banner tone="ok">No inconsistencies found by the {pluralize(validation.ran.length, 'rule')} that ran.</Banner>
      ) : (
        <>
          <FindingsSummary findings={validation.findings} />
          {sortFindings(validation.findings).map((f) => (
            <FindingCard key={f.id} finding={f} rule={rules[f.ruleId]} documents={documents} onOpen={onOpen} />
          ))}
        </>
      )}
      {validation?.agent && <AgentDecisions decisions={validation.agent.decisions} />}
      {validation?.agent?.status === 'failed' && <p className="muted small">Agent review unavailable: {validation.agent.error}</p>}
    </Card>
  );
}
