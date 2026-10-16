import type { BillingStatus, Plan } from '../../api/usage';
import { Button } from '../../components/ui/Button';
import { Tag } from '../../components/ui/Tag';
import { useI18n } from '../../i18n/useI18n';

export interface PlanListProps {
  plans: Plan[];
  current: string;
  billing?: BillingStatus;
  busy: boolean;
  onChoose: (plan: string) => void;
}

/** Every plan with what it includes; a paid one can be bought when billing is set up. */
export function PlanList({ plans, current, billing, busy, onChoose }: PlanListProps) {
  const { t } = useI18n();
  const limit = (n: number | null) => (n === null ? t('usage.unlimitedShort') : t('usage.perMonth', { count: n }));
  return (
    <ul className="plan-list">
      {plans.map((p) => (
        <li key={p.id} className="plan-item" aria-current={p.id === current ? 'true' : undefined}>
          <div className="plan-item-head">
            <h3>{p.name}</h3>
            {p.id === current && <Tag tone="ok">{t('usage.current')}</Tag>}
          </div>
          <dl>
            <dt>{t('usage.kinds.extraction')}</dt>
            <dd>{limit(p.extractionsPerMonth)}</dd>
            <dt>{t('usage.kinds.validation')}</dt>
            <dd>{limit(p.validationsPerMonth)}</dd>
          </dl>
          <p className="muted small">{p.enforcement === 'hard' ? t('usage.hard') : t('usage.soft')}</p>
          {billing?.enabled && billing.plans.includes(p.id) && p.id !== current && (
            <Button variant="primary" size="sm" disabled={busy} onClick={() => onChoose(p.id)}>
              {t('usage.upgrade', { plan: p.name })}
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
