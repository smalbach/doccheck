import { useMemo, useState } from 'react';
import type { Sample } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { TextInput } from '../../components/ui/TextInput';
import { ToggleChips } from '../../components/ui/ToggleChips';
import { SAMPLE_FILTERS, SAMPLE_PAGE_SIZE, type SampleFilter } from '../../constants/sampleErrors';
import { useI18n } from '../../i18n/useI18n';
import { filterSamples } from '../../lib/filterSamples';
import { SampleButton } from './SampleButton';

export interface SamplesCardProps {
  samples: readonly Sample[];
  demo: boolean;
  busy?: string;
  onLoad: (id: string) => void;
}

export function SamplesCard({ samples, demo, busy, onLoad }: SamplesCardProps) {
  const { t } = useI18n();
  const [filter, setFilter] = useState<SampleFilter>('all');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(SAMPLE_PAGE_SIZE);
  const matching = useMemo(() => filterSamples(samples, filter, query), [samples, filter, query]);
  const shown = matching.slice(0, limit);

  const changeFilter = (value: SampleFilter) => {
    setFilter(value);
    setLimit(SAMPLE_PAGE_SIZE);
  };

  return (
    <Card
      title={t('samples.cardTitle')}
      aside={<ToggleChips value={filter} options={SAMPLE_FILTERS.map((f) => ({ value: f.value, label: t(f.labelKey) }))} onValueChange={changeFilter} ariaLabel={t('samples.filterLabel')} />}
    >
      <p className="muted">
        {t('samples.intro')} {demo ? t('samples.introDemo') : t('samples.introLive')}
      </p>
      <TextInput className="sample-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('samples.search')} aria-label={t('samples.searchLabel')} />
      {shown.length === 0 ? (
        <p className="muted" role="status">
          {t('samples.noMatch')}
        </p>
      ) : (
        <div className="samples">
          {shown.map((s) => (
            <SampleButton key={s.id} sample={s} loading={busy === s.id} disabled={busy !== undefined} onLoad={onLoad} />
          ))}
        </div>
      )}
      {matching.length > shown.length && (
        <div className="more">
          <Button onClick={() => setLimit((n) => n + SAMPLE_PAGE_SIZE)}>
            {t('samples.showMore', { count: matching.length - shown.length })}
          </Button>
        </div>
      )}
    </Card>
  );
}
