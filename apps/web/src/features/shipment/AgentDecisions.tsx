import type { AgentDecision } from '../../api/types';
import { Disclosure } from '../../components/ui/Disclosure';
import { useI18n } from '../../i18n/useI18n';
import { AgentDecisionItem } from './AgentDecisionItem';

export function AgentDecisions({ decisions }: { decisions: readonly AgentDecision[] }) {
  const { t } = useI18n();
  if (decisions.length === 0) return null;
  return (
    <Disclosure summary={t('shipment.agent.decisions', { count: decisions.length })}>
      <ul className="decisions">
        {decisions.map((d, i) => (
          <AgentDecisionItem key={`${d.ruleId}-${i}`} decision={d} />
        ))}
      </ul>
    </Disclosure>
  );
}
