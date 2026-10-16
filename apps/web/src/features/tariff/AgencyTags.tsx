import type { AgencyFlag } from '../../api/types';
import { Tag } from '../../components/ui/Tag';

/** The agencies a code falls under: "FDA · Prior Notice of imported food". */
export function AgencyTags({ agencies }: { agencies: readonly AgencyFlag[] }) {
  if (agencies.length === 0) return null;
  return (
    <span className="tag-list" lang="en">
      {agencies.map((a) => (
        <Tag key={a.id} tone={a.severity === 'MEDIUM' ? 'accent' : 'neutral'}>
          {a.agency} · {a.program}
        </Tag>
      ))}
    </span>
  );
}
