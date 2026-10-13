import type { ValidationSummary } from '../../api/types';
import { Banner } from '../../components/ui/Banner';
import { Card } from '../../components/ui/Card';
import { useI18n } from '../../i18n/useI18n';
import { ValidationHistoryItem } from './ValidationHistoryItem';

export interface ValidationHistoryProps {
  runs: readonly ValidationSummary[];
  /** The run shown in Findings. */
  shownId?: string;
  latestId?: string;
  loadingId?: string;
  error?: string;
  onShow: (validationId: string) => void;
}

/** Every validation of the shipment, newest first; picking one shows its findings. Hidden until there are two. */
export function ValidationHistory({ runs, shownId, latestId, loadingId, error, onShow }: ValidationHistoryProps) {
  const { t } = useI18n();
  if (runs.length < 2) return null;
  return (
    <Card title={t('shipment.history.title')} aside={<span className="muted small">{t('shipment.history.count', { count: runs.length })}</span>} className="no-print">
      {error && <Banner tone="error">{error}</Banner>}
      <ol className="history-list">
        {runs.map((run) => (
          <ValidationHistoryItem key={run.id} run={run} latest={run.id === latestId} shown={run.id === shownId} loading={run.id === loadingId} onShow={() => onShow(run.id)} />
        ))}
      </ol>
    </Card>
  );
}
