import type { AgentSummary, ExtractionReport } from '../../api/types';
import type { MessageKey } from '../../i18n/keys';
import { useI18n } from '../../i18n/useI18n';
import { StatCard } from './StatCard';

export interface StatsGridProps {
  sets: readonly ExtractionReport[];
  agent: readonly AgentSummary[];
}

/** Headline numbers: fields read correctly per set, and the agent's decisions. */
export function StatsGrid({ sets, agent }: StatsGridProps) {
  const { t, formatPercent } = useI18n();
  const setLabel = (set: string) => {
    const key = `results.sets.${set}` as MessageKey;
    return t(key) === key ? set : t(key);
  };
  const kindLabel = (kind: string) => {
    const key = `results.agentKinds.${kind}` as MessageKey;
    return t(key) === key ? kind : t(key);
  };
  return (
    <div className="stats">
      {sets.map((r) => (
        <StatCard
          key={r.set}
          value={formatPercent(r.overall.accuracy)}
          label={t('results.fieldsCorrect', { set: setLabel(r.set) })}
          detail={t('results.pdfDetail', { count: r.documents, percent: formatPercent(r.classificationAccuracy) })}
        />
      ))}
      {agent.map((s) => (
        <StatCard
          key={s.kind}
          value={formatPercent(s.effectAccuracy ?? s.accuracy)}
          label={t('results.rightAction', { kind: kindLabel(s.kind) })}
          detail={t('results.agentDetail', { cases: s.cases, wrong: s.wrong, unsure: s.unsure })}
        />
      ))}
    </div>
  );
}
