import type { ReactNode } from 'react';
import type { AnalyticsFilter } from '../../api/analytics';
import { Button } from '../../components/ui/Button';
import { Field } from '../../components/ui/Field';
import { PageHeader } from '../../components/ui/PageHeader';
import { Select } from '../../components/ui/Select';
import { TextInput } from '../../components/ui/TextInput';
import { DESTINATION_FILTERS } from '../../constants/shipmentFilters';
import { useAnalyticsFilter } from '../../hooks/useAnalyticsFilter';
import type { MessageKey } from '../../i18n/keys';
import { useI18n } from '../../i18n/useI18n';

export interface AnalyticsPageProps {
  titleKey: MessageKey;
  descriptionKey: MessageKey;
  /** Leave out the date range (pages that do not read the validation history). */
  noDates?: boolean;
  /** Buttons at the right of the filters (CSV export). */
  actions?: (filter: AnalyticsFilter) => ReactNode;
  before?: ReactNode;
  children: (filter: AnalyticsFilter) => ReactNode;
}

/** A page of the Analytics section: title, the destination and date filters they share, and the body. */
export function AnalyticsPage({ titleKey, descriptionKey, noDates, actions, before, children }: AnalyticsPageProps) {
  const { t } = useI18n();
  const [state, set] = useAnalyticsFilter();
  const filter: AnalyticsFilter = {
    ...(state.destination !== 'any' ? { destination: state.destination } : {}),
    ...(!noDates && state.from ? { from: state.from } : {}),
    ...(!noDates && state.to ? { to: state.to } : {}),
  };
  return (
    <div className="page">
      {before}
      <PageHeader title={t(titleKey)} description={t(descriptionKey)} />
      <div className="analytics-filters" role="group" aria-label={t('analytics.filters.range')}>
        <Field label={t('analytics.filters.destination')}>
          {(id) => (
            <Select id={id} value={state.destination} options={DESTINATION_FILTERS.map((f) => ({ value: f.value, label: t(f.labelKey) }))} onValueChange={(destination) => set({ destination })} />
          )}
        </Field>
        {!noDates && (
          <>
            <Field label={t('analytics.filters.from')}>
              {(id) => <TextInput id={id} type="date" value={state.from} max={state.to || undefined} onChange={(e) => set({ from: e.target.value })} />}
            </Field>
            <Field label={t('analytics.filters.to')}>
              {(id) => <TextInput id={id} type="date" value={state.to} min={state.from || undefined} onChange={(e) => set({ to: e.target.value })} />}
            </Field>
            {(state.from || state.to) && (
              <Button variant="ghost" onClick={() => set({ from: '', to: '' })}>
                {t('analytics.filters.clear')}
              </Button>
            )}
          </>
        )}
        {actions && <div className="analytics-filters-actions">{actions(filter)}</div>}
      </div>
      {children(filter)}
    </div>
  );
}

/** A stable key for useQuery from a filter. */
export const filterKey = (f: AnalyticsFilter) => `${f.destination ?? ''}:${f.from ?? ''}:${f.to ?? ''}`;
