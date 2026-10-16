import { useState } from 'react';
import { usageApi, type OrgUsage, type Plan, type PlanInput } from '../../api/usage';
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

/** Server admin: the plans' monthly limits, and every organization's usage this month with its plan. */
export function PlansPage() {
  const { t } = useI18n();
  const demo = useDemo();
  const { data: loadedPlans, error } = useQuery('admin-plans', usageApi.plans);
  const { data: loadedOrgs } = useQuery('admin-usage', usageApi.orgs);
  const [plans, setPlans] = useState<Plan[]>();
  const [orgs, setOrgs] = useState<OrgUsage>();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ tone: 'ok' | 'error'; text: string }>();
  const shownPlans = plans ?? loadedPlans;
  const shownOrgs = orgs ?? loadedOrgs;
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
  const setPlan = (orgId: string, plan: string) =>
    usageApi.setPlan(orgId, plan).then(setOrgs, (e: unknown) => setStatus({ tone: 'error', text: errorMessage(e) }));
  const options = shownPlans.map((p) => ({ value: p.id, label: p.name }));
  return (
    <div className="page page-narrow">
      <PageHeader title={t('plans.title')} description={t('plans.description')} />
      {status && <Banner tone={status.tone}>{status.text}</Banner>}
      {shownPlans.map((p) => (
        <PlanEditor key={`${p.id}:${p.name}:${p.extractionsPerMonth}:${p.validationsPerMonth}:${p.warnPercent}:${p.enforcement}`} plan={p} busy={busy || demo} onSave={(input) => void save(p.id, input)} />
      ))}
      {shownOrgs && (
        <Card title={t('plans.accountsTitle')}>
          <DataTable
            caption={t('plans.accountsCaption')}
            compact
            rows={shownOrgs.orgs}
            rowKey={(r) => r.orgId}
            columns={[
              {
                key: 'org',
                header: t('plans.account'),
                cell: (r) => (
                  <>
                    {r.name}
                    {r.owner && <div className="muted small">{r.owner}</div>}
                  </>
                ),
              },
              { key: 'plan', header: t('plans.planColumn'), cell: (r) => <Select value={r.plan} options={options} onValueChange={(plan) => void setPlan(r.orgId, plan)} ariaLabel={t('plans.planFor', { email: r.name })} disabled={demo} /> },
              { key: 'extraction', header: t('usage.kinds.extraction'), cell: (r) => r.extraction, numeric: true },
              { key: 'validation', header: t('usage.kinds.validation'), cell: (r) => r.validation, numeric: true, secondary: true },
            ]}
          />
        </Card>
      )}
    </div>
  );
}
