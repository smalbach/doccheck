import { useState } from 'react';
import { usageApi } from '../../api/usage';
import { LoadingCard } from '../../components/layout/LoadingCard';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { DataTable } from '../../components/ui/DataTable';
import { PageHeader } from '../../components/ui/PageHeader';
import { useDemo } from '../../hooks/useDemo';
import { useQuery } from '../../hooks/useQuery';
import { useUsage } from '../../hooks/useUsage';
import { useI18n } from '../../i18n/useI18n';
import { errorMessage } from '../../lib/errorMessage';
import { usageDate } from '../../lib/usageDate';
import { useOrg } from '../team/useOrg';
import { PlanList } from './PlanList';
import { UsageMeter } from './UsageMeter';

/** This month's counts against the plan, the plans, past months; checkout and portal when billing is on. */
export function UsagePage({ checkout }: { checkout?: string }) {
  const { t, locale } = useI18n();
  const demo = useDemo();
  const { can } = useOrg();
  // Buying and managing the plan is for the organization's owners and admins (billing.manage).
  const buyer = !demo && can('billing.manage');
  const { data: usage, error } = useUsage();
  const { data: plans } = useQuery('plans', usageApi.plans);
  const { data: billing } = useQuery('billing', usageApi.billing);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string>();
  if (!usage) return <LoadingCard error={error} />;

  const go = (open: () => Promise<{ url: string }>) => {
    setBusy(true);
    setFailed(undefined);
    open().then(
      ({ url }) => window.location.assign(url),
      (e: unknown) => {
        setFailed(errorMessage(e));
        setBusy(false);
      },
    );
  };
  const paid = usage.plan.id !== 'free';
  return (
    <div className="page">
      <PageHeader
        title={t('usage.title')}
        description={t('usage.description')}
        actions={
          billing?.enabled && paid && buyer && (
            <Button onClick={() => go(usageApi.portal)} disabled={busy}>
              {t('usage.manage')}
            </Button>
          )
        }
      />
      {checkout === 'done' && <Banner tone="ok">{t('usage.checkoutDone')}</Banner>}
      {checkout === 'cancelled' && <Banner tone="info">{t('usage.checkoutCancelled')}</Banner>}
      {failed && <Banner tone="error">{failed}</Banner>}
      {busy && <p role="status" className="muted">{t('usage.redirecting')}</p>}
      <Card title={t('usage.plan', { plan: usage.plan.name })} aside={<span className="muted small">{t('usage.resets', { date: usageDate(usage.resetsAt, locale) })}</span>}>
        <div className="usage-meters">
          {usage.meters.map((m) => (
            <UsageMeter key={m.kind} meter={m} />
          ))}
        </div>
        {!usage.enforced && <p className="muted small">{t('usage.notEnforced')}</p>}
      </Card>
      {plans && (
        <Card title={t('usage.plansTitle')}>
          <p className="muted small">{billing?.enabled ? t('usage.billingTest') : t('usage.billingOff')}</p>
          <PlanList plans={plans} current={usage.plan.id} billing={buyer ? billing : undefined} busy={busy} onChoose={(plan) => go(() => usageApi.checkout(plan))} />
        </Card>
      )}
      {usage.history.length > 0 && (
        <Card title={t('usage.history')}>
          <DataTable
            caption={t('usage.historyCaption')}
            compact
            rows={usage.history}
            rowKey={(r) => r.month}
            columns={[
              { key: 'month', header: t('usage.month'), cell: (r) => usageDate(r.month, locale, true) },
              { key: 'extraction', header: t('usage.kinds.extraction'), cell: (r) => r.extraction, numeric: true },
              { key: 'validation', header: t('usage.kinds.validation'), cell: (r) => r.validation, numeric: true },
            ]}
          />
        </Card>
      )}
    </div>
  );
}
