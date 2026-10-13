import type { AgentDecision } from '../../api/types';

export function AgentDecisionItem({ decision }: { decision: AgentDecision }) {
  return (
    <li>
      <strong>{decision.ruleId}</strong> {decision.question} <span className={`verdict verdict-${decision.verdict}`}>{decision.verdict}</span>{' '}
      <span className="muted small">
        {Math.round(decision.confidence * 100)}% · {decision.effect}
      </span>
      <div className="muted small">{decision.rationale}</div>
    </li>
  );
}
