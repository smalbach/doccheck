import { useState } from 'react';
import { usageApi, type AccountUsage, type Plan, type PlanInput } from '../../api/usage';
import { LoadingCard } from '../../components/layout/LoadingCard';
import { Banner } from '../../components/ui/Banner';
import { Card } from '../../components/ui/Card';
import { DataTable } from '../../components/ui/DataTable';
import { PageHeader } from '../../components/ui/PageHeader';
import { Select } from '../../components/ui/Select';
import { useDemo } from '../../hooks/useDemo';
import { useQuery } from '../../hooks/useQuery';
import { useI18n } from '../../i18n/useI18n';
import { errorMessage } from '../../lib/errorMessage';
import { PlanEditor } from './PlanEditor';

/** Admin: the plans' monthly limits, and every account's usage this month with its plan. */
export function PlansPage() {
  const { t } = useI18n();
  const demo = useDemo();
  const { data: loadedPlans, error } = useQuery('admin-plans', usageApi.plans);
  const { data: loadedAccounts } = useQuery('admin-usage', usageApi.accounts);
  const [plans, setPlans] = useState<Plan[]>();
  const [accounts, setAccounts] = useState<AccountUsage>();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ tone: 'ok' | 'error'; text: string }>();
  const shownPlans = plans ?? loadedPlans;
  const shownAccounts = accounts ?? loadedAccounts;
  if (!shownPlans) return <LoadingCard error={error} />;

  const save = async (id: string, input: PlanInput) => {
    setBusy(true);
    try {
      const saved = await usageApi.updatePlan(id, input);
      setPlans(shownPlans.map((p) => (p.id === id ? saved : p)));
      setStatus({ tone: 'ok', text: t('plans.saved') });
    } catch (e) {
      setStatus({ tone: 'error', text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  const setPlan = (userId: string, plan: string) =>
    usageApi.setPlan(userId, plan).then(setAccounts, (e: unknown) => setStatus({ tone: 'error', text: errorMessage(e) }));
  const options = shownPlans.map((p) => ({ value: p.id, label: p.name }));
  return (
    <div className="page page-narrow">
      <PageHeader title={t('plans.title')} description={t('plans.description')} />
      {status && <Banner tone={status.tone}>{status.text}</Banner>}
      {shownPlans.map((p) => (
        <PlanEditor key={`${p.id}:${p.name}:${p.extractionsPerMonth}:${p.validationsPerMonth}:${p.warnPercent}:${p.enforcement}`} plan={p} busy={busy || demo} onSave={(input) => void save(p.id, input)} />
      ))}
      {shownAccounts && (
        <Card title={t('plans.accountsTitle')}>
          <DataTable
            caption={t('plans.accountsCaption')}
            compact
            rows={shownAccounts.accounts}
            rowKey={(r) => r.userId}
            columns={[
              { key: 'email', header: t('plans.account'), cell: (r) => r.email },
              { key: 'plan', header: t('plans.planColumn'), cell: (r) => <Select value={r.plan} options={options} onValueChange={(plan) => void setPlan(r.userId, plan)} ariaLabel={t('plans.planFor', { email: r.email })} disabled={demo} /> },
              { key: 'extraction', header: t('usage.kinds.extraction'), cell: (r) => r.extraction, numeric: true },
              { key: 'validation', header: t('usage.kinds.validation'), cell: (r) => r.validation, numeric: true, secondary: true },
            ]}
          />
        </Card>
      )}
    </div>
  );
}
