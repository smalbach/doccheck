import { ReloadIcon } from '@radix-ui/react-icons';
import { useState } from 'react';
import { LoadingCard } from '../../../components/layout/LoadingCard';
import { Banner } from '../../../components/ui/Banner';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Checkbox } from '../../../components/ui/Checkbox';
import { PageHeader } from '../../../components/ui/PageHeader';
import { useI18n } from '../../../i18n/useI18n';
import { AllowlistTable } from '../../screening/AllowlistTable';
import { ScreeningListsTable } from '../../screening/ScreeningListsTable';
import { useAllowlist } from '../../screening/useAllowlist';
import { ThresholdsCard } from './ThresholdsCard';
import { useAdminScreening } from './useAdminScreening';

/** Admin: the cached lists and their versions, refresh, thresholds, and every account's allowlist with its trail. */
export function ScreeningAdminPage() {
  const { t, formatDateTime, formatNumber } = useI18n();
  const { status, error, busy, refresh, saveThresholds, resetThresholds } = useAdminScreening();
  const allowlist = useAllowlist(true);
  const [notice, setNotice] = useState<string>();
  if (!status) return <LoadingCard error={error} />;
  const { editable, refreshing, lastRefresh } = status;
  const failed = lastRefresh?.outcomes?.filter((o) => !o.ok) ?? [];

  return (
    <div className="page">
      <PageHeader
        title={t('screening.admin.title')}
        description={t('screening.admin.description')}
        actions={
          <Button
            variant="primary"
            onClick={() => {
              setNotice(undefined);
              void refresh();
            }}
            disabled={!editable || busy || !!refreshing}
          >
            <ReloadIcon aria-hidden /> {t('screening.admin.refresh')}
          </Button>
        }
      />
      {!editable && <Banner tone="info">{t('screening.admin.readOnly')}</Banner>}
      {error && <Banner tone="error">{error}</Banner>}
      {notice && <Banner tone="ok">{notice}</Banner>}
      {refreshing && <Banner tone="info">{t('screening.admin.refreshing', { date: formatDateTime(refreshing.startedAt), who: refreshing.by })}</Banner>}
      {!refreshing && lastRefresh?.finishedAt && (
        <Banner tone={failed.length || lastRefresh.error ? 'warning' : 'ok'}>
          {t('screening.admin.lastRefresh', {
            date: formatDateTime(lastRefresh.finishedAt),
            who: lastRefresh.by,
            ok: lastRefresh.outcomes?.filter((o) => o.ok).length ?? 0,
            total: lastRefresh.outcomes?.length ?? 0,
          })}
          {failed.map((o) => (
            <span key={o.source}> {t('screening.admin.refreshFailed', { source: o.source, error: o.error ?? '' })}</span>
          ))}
          {lastRefresh.error && <span> {lastRefresh.error}</span>}
        </Banner>
      )}
      <Card title={t('screening.lists.title')}>
        <p className="muted">
          {t('screening.lists.total', { entries: formatNumber(status.entries), lists: status.lists.filter((l) => l.cached).length })} ·{' '}
          <span className="mono small screening-path">{t('screening.admin.cache', { dir: status.dir })}</span>
          {status.refreshedAt && <> · {formatDateTime(status.refreshedAt)}</>}
        </p>
        <ScreeningListsTable lists={status.lists} />
      </Card>
      <ThresholdsCard
        key={`${status.thresholds.match}-${status.thresholds.review}`}
        thresholds={status.thresholds}
        editable={editable}
        busy={busy}
        onSave={(values) => void saveThresholds(values).then((ok) => ok && setNotice(t('screening.admin.saved')))}
        onReset={() => void resetThresholds()}
      />
      <Card title={t('screening.admin.allAccounts')} aside={<Checkbox label={t('screening.allowlist.history')} checked={allowlist.history} onCheckedChange={allowlist.setHistory} />}>
        {allowlist.error && <Banner tone="error">{allowlist.error}</Banner>}
        {allowlist.items &&
          (allowlist.items.length === 0 ? (
            <p className="muted">{t('screening.allowlist.empty')}</p>
          ) : (
            <AllowlistTable items={allowlist.items} showOrganization readOnly onRemove={(item) => void allowlist.remove(item)} />
          ))}
      </Card>
    </div>
  );
}
