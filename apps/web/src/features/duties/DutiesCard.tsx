import { FileTextIcon } from '@radix-ui/react-icons';
import { useState } from 'react';
import type { ShipmentDocument } from '../../api/types';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Disclosure } from '../../components/ui/Disclosure';
import { useI18n } from '../../i18n/useI18n';
import type { ViewerTarget } from '../pdf/types';
import { DutyFeesTaxes } from './DutyFeesTaxes';
import { DutyFindingList } from './DutyFindingList';
import { DutyLinesTable } from './DutyLinesTable';
import { DutyPreference } from './DutyPreference';
import { DutyQuestions } from './DutyQuestions';
import { DutyTotals } from './DutyTotals';
import { DutyValuation } from './DutyValuation';
import { EntryDraftSheet } from './EntryDraftSheet';
import type { DutiesState } from './useDuties';

export interface DutiesCardProps {
  duties: DutiesState;
  /** The destination has rate tables (Canada, US). */
  supported: boolean;
  documents: ReadonlyMap<string, ShipmentDocument>;
  demo: boolean;
  /** The user may answer the questions (shipment.write, or the demo, where answers are not saved). */
  canAnswer: boolean;
  onOpen: (target: ViewerTarget) => void;
}

/** Duty, taxes and landed cost of the shipment, what is missing to value it, and the draft entry summary. */
export function DutiesCard({ duties, supported, documents, demo, canAnswer, onOpen }: DutiesCardProps) {
  const { t } = useI18n();
  const [entryOpen, setEntryOpen] = useState(false);
  const [focus, setFocus] = useState<string>();
  const { view, error } = duties;
  const estimate = supported ? view?.estimate : undefined;

  return (
    <Card
      className="duties"
      title={t('duties.title')}
      aside={
        supported && view?.entry && (
          <Button className="no-print" onClick={() => setEntryOpen(true)}>
            <FileTextIcon aria-hidden /> {t('duties.entry.open')}
          </Button>
        )
      }
    >
      <p className="small muted">{t('duties.note')}</p>
      {!supported && <p className="muted">{t('duties.otherDestination')}</p>}
      {error && <Banner tone="error">{error}</Banner>}
      {supported && !estimate && !error && (
        <p className="muted" role="status">
          {t('duties.loading')}
        </p>
      )}
      {estimate?.status === 'unavailable' && <p className="muted">{t('duties.unavailable', { reason: estimate.unavailableReason ?? '' })}</p>}
      {estimate && estimate.status !== 'unavailable' && (
        <>
          <p className="small">{t('duties.asOf', { date: estimate.entryDate, currency: estimate.currency })}</p>
          {estimate.status === 'partial' && <Banner tone="warning">{t('duties.partial')}</Banner>}
          <DutyTotals estimate={estimate} />
          <DutyLinesTable estimate={estimate} />
          <div className="duties-columns">
            <DutyValuation estimate={estimate} />
            <DutyFeesTaxes estimate={estimate} />
          </div>
          <DutyPreference estimate={estimate} />
        </>
      )}
      {estimate && <DutyFindingList findings={estimate.findings} documents={documents} onOpen={onOpen} onAnswer={canAnswer ? setFocus : undefined} />}
      {estimate && canAnswer && (
        <DutyQuestions key={view?.inputsUpdatedAt ?? 'new'} estimate={estimate} savedAt={view?.inputsUpdatedAt} busy={duties.busy} demo={demo} focus={focus} onFocused={() => setFocus(undefined)} onSubmit={duties.submit} />
      )}
      {estimate && estimate.tables.length > 0 && (
        <Disclosure summary={t('duties.tables.title')}>
          <ul className="duty-tables small">
            {estimate.tables.map((m) => (
              <li key={m.table}>
                {m.url ? (
                  <a href={m.url} target="_blank" rel="noreferrer">
                    {m.source}
                  </a>
                ) : (
                  m.source
                )}
                {': '}
                {[m.revision ?? m.version, m.effectiveDate ?? m.dataDate ?? m.retrievedAt].filter(Boolean).join(', ')}
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
      {entryOpen && view?.entry && <EntryDraftSheet entry={view.entry} onClose={() => setEntryOpen(false)} />}
    </Card>
  );
}
