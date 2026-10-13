import type { Finding, RuleDefinition, ShipmentDocument } from '../../api/types';
import { Tag } from '../../components/ui/Tag';
import { useI18n } from '../../i18n/useI18n';
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
  const { t } = useI18n();
  return (
    <article className={`finding finding-${finding.severity}`} aria-labelledby={`finding-${finding.id}`}>
      <header>
        <span className={`severity severity-${finding.severity}`}>{t(`severity.${finding.severity}`)}</span>
        <h3 className="rule-id" id={`finding-${finding.id}`}>
          {finding.ruleId}
        </h3>
        {rule && (
          <span className="rule-title" lang="en">
            {rule.title}
          </span>
        )}
        {finding.decidedBy === 'AGENT' && <Tag tone="accent">{t('shipment.findings.agent')}</Tag>}
      </header>
      <p lang="en">{finding.message}</p>
      <ul className="evidence">
        {finding.evidence.map((e, i) => (
          <EvidenceItem key={`${e.documentId}-${e.field}-${i}`} evidence={e} doc={documents.get(e.documentId)} onOpen={onOpen} />
        ))}
      </ul>
      {finding.agentRationale && (
        <p className="rationale">
          <strong>{t('shipment.findings.agentLabel')}</strong> <span lang="en">{finding.agentRationale}</span>
        </p>
      )}
      {finding.suggestedFix && (
        <p className="fix" lang="en">
          {finding.suggestedFix}
        </p>
      )}
      {finding.regulation && <RegulationQuote regulation={finding.regulation} />}
    </article>
  );
}
