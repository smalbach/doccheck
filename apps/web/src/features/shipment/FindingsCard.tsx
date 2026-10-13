import { useEffect, useState, type ReactNode } from 'react';
import type { ReviewStatus, RuleDefinition, ShipmentDocument, Validation } from '../../api/types';
import { ToggleChips } from '../../components/ui/ToggleChips';
import { isClosed, matchesFilter, type FindingFilter } from '../../lib/findingReview';
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
import { ResolvedFindings } from './ResolvedFindings';
import { SupplierRequestDialog } from './SupplierRequestDialog';

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
  /** Decisions, corrections and the supplier request, on the latest run outside the demo. */
  review?: {
    busy: boolean;
    reference: string;
    onReview: (fingerprints: string[], status: ReviewStatus, note?: string) => Promise<void>;
    onCorrect: (doc: ShipmentDocument, field: string) => void;
  };
}

export function FindingsCard({ validation, rules, documents, onOpen, notice, progress, live, run, review }: FindingsCardProps) {
  const { t, formatDateTime } = useI18n();
  const [filter, setFilter] = useState<FindingFilter>('open');
  // The printed report has every finding, with its status.
  useEffect(() => {
    const all = () => setFilter('all');
    window.addEventListener('beforeprint', all);
    return () => window.removeEventListener('beforeprint', all);
  }, []);
  const findings = validation?.findings ?? [];
  const closedCount = findings.filter(isClosed).length;
  const counts: Record<FindingFilter, number> = { open: findings.length - closedCount, closed: closedCount, all: findings.length };
  // Past runs carry no decisions and are not reviewed here: everything shows, without the filter.
  const filterable = !!review || closedCount > 0;
  const shown = sortFindings(filterable ? findings.filter((f) => matchesFilter(f, filter)) : findings);
  const openFindings = findings.filter((f) => !isClosed(f) && f.fingerprint);
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
              {filterable && (
                <div className="findings-toolbar">
                  <ToggleChips
                    value={filter}
                    options={(['open', 'closed', 'all'] as const).map((v) => ({ value: v, label: t(`review.filter.${v}`, { count: counts[v] }) }))}
                    onValueChange={setFilter}
                    ariaLabel={t('review.filter.label')}
                  />
                  {review && (
                    <SupplierRequestDialog findings={openFindings} documents={documents} reference={review.reference} onMarkWaiting={(fps) => review.onReview(fps, 'waiting_supplier')} />
                  )}
                </div>
              )}
              {filterable && counts.open === 0 && filter === 'open' && <Banner tone="ok">{t('review.allClosed')}</Banner>}
              {filterable && shown.length === 0 && filter !== 'open' && <p className="muted">{t('review.noneOpen')}</p>}
              <ol className="finding-list" aria-label={t('shipment.findings.title')}>
                {shown.map((f) => (
                  <li key={f.id} id={findingAnchorId(f.id)} tabIndex={-1} className="finding-item">
                    <FindingCard
                      finding={f}
                      rule={rules[f.ruleId]}
                      documents={documents}
                      onOpen={onOpen}
                      review={review && f.fingerprint ? { busy: review.busy, onReview: (status, note) => review.onReview([f.fingerprint!], status, note), onCorrect: review.onCorrect } : undefined}
                    />
                  </li>
                ))}
              </ol>
            </>
          )}
          {validation?.resolved && validation.previous && <ResolvedFindings findings={validation.resolved} since={validation.previous.createdAt} rules={rules} />}
          {validation && run?.runId === validation.id && <DismissedFindings findings={dismissedFindings(run.findings)} rules={rules} />}
          {validation?.agent && <AgentDecisions decisions={validation.agent.decisions} />}
          {validation?.agent?.status === 'failed' && <p className="muted small">{t('shipment.agent.unavailable', { error: validation.agent.error ?? '' })}</p>}
        </>
      )}
    </Card>
  );
}
