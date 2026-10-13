import type { Sample } from '../../api/types';
import { Tag } from '../../components/ui/Tag';
import { Tooltip } from '../../components/ui/Tooltip';
import { SampleErrorTags } from './SampleErrorTags';

export interface SampleButtonProps {
  sample: Sample;
  loading: boolean;
  disabled: boolean;
  onLoad: (id: string) => void;
}

export function SampleButton({ sample, loading, disabled, onLoad }: SampleButtonProps) {
  const description = sample.errors.map((e) => e.description).join('\n') || 'A clean shipment: the rules should find nothing.';
  return (
    <Tooltip content={description}>
      <button type="button" className="sample" onClick={() => onLoad(sample.id)} disabled={disabled}>
        <span className="sample-id">
          {sample.id} <Tag tone="accent">{sample.destination}</Tag>
        </span>
        <span className="sample-errors">
          <SampleErrorTags errors={sample.errors} />
        </span>
        {loading && <span className="muted small">Loading…</span>}
      </button>
    </Tooltip>
  );
}
