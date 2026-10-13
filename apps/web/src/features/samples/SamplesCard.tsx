import { useMemo, useState } from 'react';
import type { Sample } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { TextInput } from '../../components/ui/TextInput';
import { ToggleChips } from '../../components/ui/ToggleChips';
import { SAMPLE_FILTERS, SAMPLE_PAGE_SIZE, type SampleFilter } from '../../constants/sampleErrors';
import { filterSamples } from '../../lib/filterSamples';
import { SampleButton } from './SampleButton';

export interface SamplesCardProps {
  samples: readonly Sample[];
  demo: boolean;
  busy?: string;
  onLoad: (id: string) => void;
}

export function SamplesCard({ samples, demo, busy, onLoad }: SamplesCardProps) {
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
    <Card title="Pick a sample" aside={<ToggleChips value={filter} options={SAMPLE_FILTERS} onValueChange={changeFilter} ariaLabel="Filter samples" />}>
      <p className="muted">
        Synthetic shipments with known, injected errors.{' '}
        {demo ? 'Loading one opens its three PDFs, already extracted by the local model.' : 'Loading one uploads its three PDFs and extracts them with the local model (about 30 s per document).'}
      </p>
      <TextInput className="sample-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find by ID, e.g. US-042" aria-label="Find a sample by ID" />
      {shown.length === 0 ? (
        <p className="muted">No sample matches.</p>
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
            Show more ({matching.length - shown.length} left)
          </Button>
        </div>
      )}
    </Card>
  );
}
