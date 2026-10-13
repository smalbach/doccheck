import type { AgentDecision } from '../../api/types';
import { Disclosure } from '../../components/ui/Disclosure';
import { AgentDecisionItem } from './AgentDecisionItem';

export function AgentDecisions({ decisions }: { decisions: readonly AgentDecision[] }) {
  if (decisions.length === 0) return null;
  return (
    <Disclosure summary={`Agent decisions (${decisions.length})`}>
      <ul className="decisions">
        {decisions.map((d, i) => (
          <AgentDecisionItem key={`${d.ruleId}-${i}`} decision={d} />
        ))}
      </ul>
    </Disclosure>
  );
}
