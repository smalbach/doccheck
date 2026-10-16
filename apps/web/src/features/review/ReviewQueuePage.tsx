import { useState } from 'react';
import { reviewApi } from '../../api/review';
import { LoadingCard } from '../../components/layout/LoadingCard';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pager } from '../../components/ui/Pager';
import { useQuery } from '../../hooks/useQuery';
import { useI18n } from '../../i18n/useI18n';
import { StatTile } from '../dashboard/StatTile';
import { LearnedSuppliersCard } from './LearnedSuppliersCard';
import { ReviewQueueTable } from './ReviewQueueTable';

const PAGE = 25;

/** Documents whose extraction is unsure of some values, least sure first. */
export function ReviewQueuePage() {
  const { t } = useI18n();
  const [offset, setOffset] = useState(0);
  const { data, error, loading } = useQuery(`review-queue:${offset}`, () => reviewApi.queue({ limit: PAGE, offset }));
  if (!data) return <LoadingCard error={error} />;
  const first = data.items[0];
  return (
    <div className="page">
      <PageHeader
        title={t('reviewQueue.title')}
        description={t('reviewQueue.description')}
        actions={
          first && (
            <Button asChild variant="primary">
              <a href={`#/app/review/${first.documentId}`}>{t('reviewQueue.start')}</a>
            </Button>
          )
        }
      />
      <div className="stat-tiles">
        <StatTile label={t('reviewQueue.tiles.documents')} value={data.total} tone={data.total ? 'attention' : 'ok'} hint={t('reviewQueue.tiles.threshold', { percent: Math.round(data.threshold * 100) })} />
        <StatTile label={t('reviewQueue.tiles.fields')} value={data.fields} />
      </div>
      <Card>
        {data.items.length === 0 ? (
          <EmptyState title={t('reviewQueue.emptyTitle')}>{t('reviewQueue.emptyText')}</EmptyState>
        ) : (
          <>
            <ReviewQueueTable items={data.items} />
            <Pager offset={offset} limit={PAGE} total={data.total} onOffsetChange={setOffset} label={t('reviewQueue.tableCaption')} busy={loading} />
          </>
        )}
      </Card>
      <LearnedSuppliersCard />
    </div>
  );
}
