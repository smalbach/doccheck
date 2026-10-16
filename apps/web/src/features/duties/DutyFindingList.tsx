import type { DutyFinding } from '../../api/dutyTypes';
import type { ShipmentDocument } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { useI18n } from '../../i18n/useI18n';
import type { ViewerTarget } from '../pdf/types';
import { EvidenceItem } from '../shipment/EvidenceItem';
import { RegulationQuote } from '../shipment/RegulationQuote';

export interface DutyFindingListProps {
  findings: readonly DutyFinding[];
  documents: ReadonlyMap<string, ShipmentDocument>;
  onOpen: (target: ViewerTarget) => void;
  /** Focuses the question that answers a finding. */
  onAnswer: (field: string) => void;
}

/** What could not be valued, classified or proven, each with its evidence and, where there is one, the regulation. */
export function DutyFindingList({ findings, documents, onOpen, onAnswer }: DutyFindingListProps) {
  const { t } = useI18n();
  return (
    <section className="duty-section" aria-labelledby="duty-findings">
      <h3 id="duty-findings">{t('duties.findings.title')}</h3>
      {findings.length === 0 ? (
        <p className="small muted">{t('duties.findings.none')}</p>
      ) : (
        <ul className="finding-list">
          {findings.map((f, i) => (
            <li key={`${f.code}-${i}`} className="finding-item">
              <article className={`finding finding-${f.severity}`} aria-labelledby={`duty-finding-${i}`}>
                <header>
                  <span className={`severity severity-${f.severity}`}>{t(`severity.${f.severity}`)}</span>
                  <code>{f.code}</code>
                  <strong id={`duty-finding-${i}`}>{t(`duties.codes.${f.code}`)}</strong>
                </header>
                <p lang="en">{f.message}</p>
                {f.suggestedFix && (
                  <p className="small" lang="en">
                    {f.suggestedFix}
                  </p>
                )}
                {f.evidence.length > 0 && (
                  <ul className="evidence small">
                    {f.evidence.map((ev, j) => (
                      <EvidenceItem key={j} evidence={ev} doc={documents.get(ev.documentId)} onOpen={onOpen} />
                    ))}
                  </ul>
                )}
                {f.regulation && <RegulationQuote regulation={f.regulation} />}
                {f.asks && (
                  <Button variant="link" size="sm" className="no-print" onClick={() => onAnswer(f.asks!)}>
                    {t('duties.findings.answer')}
                  </Button>
                )}
              </article>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
