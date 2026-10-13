import type { AgentSummary, ExtractionReport } from '../../api/types';
import { AGENT_DECISION_LABEL, EVALUATION_SET_LABEL } from '../../constants/results';
import { formatPercent } from '../../lib/formatPercent';
import { StatCard } from './StatCard';

export interface StatsGridProps {
  sets: readonly ExtractionReport[];
  agent: readonly AgentSummary[];
}

/** Headline numbers: fields read correctly per set, and the agent's decisions. */
export function StatsGrid({ sets, agent }: StatsGridProps) {
  return (
    <div className="stats">
      {sets.map((r) => (
        <StatCard
          key={r.set}
          value={formatPercent(r.overall.accuracy)}
          label={`fields read correctly · ${EVALUATION_SET_LABEL[r.set] ?? r.set}`}
          detail={`${r.documents} PDFs · document type ${formatPercent(r.classificationAccuracy)}`}
        />
      ))}
      {agent.map((s) => (
        <StatCard
          key={s.kind}
          value={formatPercent(s.effectAccuracy ?? s.accuracy)}
          label={`right action · agent: ${AGENT_DECISION_LABEL[s.kind] ?? s.kind}`}
          detail={`${s.cases} cases · ${s.wrong} wrong · ${s.unsure} unsure`}
        />
      ))}
    </div>
  );
}
