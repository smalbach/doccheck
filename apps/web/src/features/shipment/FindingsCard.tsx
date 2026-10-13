import type { ReactNode } from 'react';
import type { RuleDefinition, ShipmentDocument, Validation } from '../../api/types';
import { Banner } from '../../components/ui/Banner';
import { Card } from '../../components/ui/Card';
import { useI18n } from '../../i18n/useI18n';
import { dismissedFindings, findingAnchorId } from '../../lib/liveFindings';
import type { RunTimeline } from '../../lib/progressTimeline';
import { sortFindings } from '../../lib/sortFindings';
import type { ViewerTarget } from '../pdf/types';
import { AgentDecisions } from './AgentDecisions';
import { DismissedFindings } from './DismissedFindings';
import { FindingCard } from './FindingCard';
import { FindingsSummary } from './FindingsSummary';
import { LiveFindingList } from './LiveFindingList';

export interface FindingsCardProps {
  validation?: Validation;
  rules: Readonly<Record<string, RuleDefinition>>;
  documents: ReadonlyMap<string, ShipmentDocument>;
  onOpen: (target: ViewerTarget) => void;
  /** Above the findings: a past run is shown, or the destination changed since. */
  notice?: ReactNode;
  /** At the top: the validation running now, or how long the shown one took (ValidationProgress). */
  progress?: ReactNode;
  /** A validation shown live from its events instead of `validation` (liveValidationRun). */
  live?: RunTimeline;
  /** The latest validation run from the events: when it is the one shown, the findings its agent dismissed. */
  run?: RunTimeline;
}

export function FindingsCard({ validation, rules, documents, onOpen, notice, progress, live, run }: FindingsCardProps) {
  const { t, formatDateTime } = useI18n();
  const aside = !live && validation && (
    <span className="muted small">
      {formatDateTime(validation.createdAt)} · {t('shipment.findings.ran', { count: validation.ran.length })}
    </span>
  );
  // Live findings come one by one: the card stays quiet then (ProgressAnnouncer speaks the milestones).
  return (
    <Card title={t('shipment.findings.title')} aside={aside} className="findings" aria-live={live ? 'off' : 'polite'}>
      {progress}
      {live ? (
        <LiveFindingList findings={live.findings} rules={rules} />
      ) : (
        <>
          {notice}
          {!validation ? (
            <p className="muted">{t('shipment.findings.empty')}</p>
          ) : validation.findings.length === 0 ? (
            <Banner tone="ok">{t('shipment.findings.none', { count: validation.ran.length })}</Banner>
          ) : (
            <>
              <FindingsSummary findings={validation.findings} />
              <ol className="finding-list" aria-label={t('shipment.findings.title')}>
                {sortFindings(validation.findings).map((f) => (
                  <li key={f.id} id={findingAnchorId(f.id)} tabIndex={-1} className="finding-item">
                    <FindingCard finding={f} rule={rules[f.ruleId]} documents={documents} onOpen={onOpen} />
                  </li>
                ))}
              </ol>
            </>
          )}
          {validation && run?.runId === validation.id && <DismissedFindings findings={dismissedFindings(run.findings)} rules={rules} />}
          {validation?.agent && <AgentDecisions decisions={validation.agent.decisions} />}
          {validation?.agent?.status === 'failed' && <p className="muted small">{t('shipment.agent.unavailable', { error: validation.agent.error ?? '' })}</p>}
        </>
      )}
    </Card>
  );
}
