import type { SampleError } from '../../api/types';
import { Tag } from '../../components/ui/Tag';
import { SAMPLE_ERROR_LABEL } from '../../constants/sampleErrors';

export function SampleErrorTags({ errors }: { errors: readonly SampleError[] }) {
  if (errors.length === 0) return <Tag tone="ok">no errors</Tag>;
  return (
    <>
      {errors.map((e, i) => (
        <Tag key={`${e.kind}-${i}`}>{SAMPLE_ERROR_LABEL[e.kind] ?? e.kind}</Tag>
      ))}
    </>
  );
}
