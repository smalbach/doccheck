import type { ReactNode } from 'react';
import type { RuleDefinition, ShipmentDocument, Validation } from '../../api/types';
import { Banner } from '../../components/ui/Banner';
import { Card } from '../../components/ui/Card';
import { useI18n } from '../../i18n/useI18n';
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
  /** Above the findings: a past run is shown, or the destination changed since. */
  notice?: ReactNode;
  /** At the top: the validation running now, or how long the shown one took (ValidationProgress). */
  progress?: ReactNode;
}

export function FindingsCard({ validation, rules, documents, onOpen, notice, progress }: FindingsCardProps) {
  const { t, formatDateTime } = useI18n();
  const aside = validation && (
    <span className="muted small">
      {formatDateTime(validation.createdAt)} · {t('shipment.findings.ran', { count: validation.ran.length })}
    </span>
  );
  return (
    <Card title={t('shipment.findings.title')} aside={aside} className="findings" aria-live="polite">
      {progress}
      {notice}
      {!validation ? (
        <p className="muted">{t('shipment.findings.empty')}</p>
      ) : validation.findings.length === 0 ? (
        <Banner tone="ok">{t('shipment.findings.none', { count: validation.ran.length })}</Banner>
      ) : (
        <>
          <FindingsSummary findings={validation.findings} />
          {sortFindings(validation.findings).map((f) => (
            <FindingCard key={f.id} finding={f} rule={rules[f.ruleId]} documents={documents} onOpen={onOpen} />
          ))}
        </>
      )}
      {validation?.agent && <AgentDecisions decisions={validation.agent.decisions} />}
      {validation?.agent?.status === 'failed' && <p className="muted small">{t('shipment.agent.unavailable', { error: validation.agent.error ?? '' })}</p>}
    </Card>
  );
}
