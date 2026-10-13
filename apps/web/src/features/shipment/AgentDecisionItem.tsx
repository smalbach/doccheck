import type { AgentDecision } from '../../api/types';
import { useI18n } from '../../i18n/useI18n';

export function AgentDecisionItem({ decision }: { decision: AgentDecision }) {
  const { t } = useI18n();
  return (
    <li>
      <strong>{decision.ruleId}</strong> <span lang="en">{decision.question}</span> <span className={`verdict verdict-${decision.verdict}`}>{t(`shipment.agent.verdicts.${decision.verdict}`)}</span>{' '}
      <span className="muted small">
        {Math.round(decision.confidence * 100)}% · {t(`shipment.agent.effects.${decision.effect}`)}
      </span>
      <div className="muted small" lang="en">
        {decision.rationale}
      </div>
    </li>
  );
}
