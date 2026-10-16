import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { ScreeningStatus } from '../../api/types';
import { LoadingCard } from '../../components/layout/LoadingCard';
import { Banner } from '../../components/ui/Banner';
import { Card } from '../../components/ui/Card';
import { Checkbox } from '../../components/ui/Checkbox';
import { PageHeader } from '../../components/ui/PageHeader';
import { useDemo } from '../../hooks/useDemo';
import { useI18n } from '../../i18n/useI18n';
import { useOrg } from '../team/useOrg';
import { errorMessage } from '../../lib/errorMessage';
import { AllowlistTable } from './AllowlistTable';
import { NameCheckCard } from './NameCheckCard';
import { ScreeningListsTable } from './ScreeningListsTable';
import { useAllowlist } from './useAllowlist';

/** Party screening for every user: the lists in use, checking a name, and the account's allowlist. */
export function ScreeningPage() {
  const { t, formatNumber } = useI18n();
  const demo = useDemo();
  const { can } = useOrg();
  // Setting a match aside, or putting it back, is a decision about findings.
  const readOnly = demo || !can('finding.decide');
  const [status, setStatus] = useState<ScreeningStatus>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const allowlist = useAllowlist();

  useEffect(() => {
    api.screeningLists().then(setStatus, (err: unknown) => setError(errorMessage(err)));
  }, []);
  if (!status) return <LoadingCard error={error} />;
  const cached = status.lists.filter((l) => l.cached);

  return (
    <div className="page">
      <PageHeader title={t('screening.title')} description={t('screening.description')} />
      {notice && <Banner tone="ok">{notice}</Banner>}
      <Card title={t('screening.lists.title')}>
        {cached.length === 0 ? (
          <Banner tone="warning">{t('screening.lists.empty')}</Banner>
        ) : (
          <p className="muted">
            {t('screening.lists.total', { entries: formatNumber(status.entries), lists: cached.length })}.{' '}
            {t('screening.thresholdsText', { match: formatNumber(status.thresholds.match, 3), review: formatNumber(status.thresholds.review, 3) })}
          </p>
        )}
        <ScreeningListsTable lists={status.lists} />
      </Card>
      <NameCheckCard
        readOnly={readOnly}
        onAdded={() => {
          setNotice(t('screening.allowlist.added'));
          void allowlist.reload();
        }}
      />
      <Card title={t('screening.allowlist.title')} aside={<Checkbox label={t('screening.allowlist.history')} checked={allowlist.history} onCheckedChange={allowlist.setHistory} />}>
        <p className="muted">{t('screening.allowlist.text')}</p>
        {allowlist.error && <Banner tone="error">{allowlist.error}</Banner>}
        {allowlist.items &&
          (allowlist.items.length === 0 ? (
            <p className="muted">{t('screening.allowlist.empty')}</p>
          ) : (
            <AllowlistTable
              items={allowlist.items}
              readOnly={readOnly}
              onRemove={(item) => void allowlist.remove(item).then((ok) => ok && setNotice(t('screening.allowlist.removed')))}
            />
          ))}
      </Card>
    </div>
  );
}
