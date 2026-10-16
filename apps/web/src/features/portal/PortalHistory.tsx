import type { PortalView } from '../../api/portal';
import { Card } from '../../components/ui/Card';
import { useI18n } from '../../i18n/useI18n';
import { PortalStatusTag } from './PortalStatusTag';

/** The supplier's requests from the same importer, by status only: none of them opens from here. */
export function PortalHistory({ history, importer }: { history: PortalView['history']; importer: string }) {
  const { t, formatDateTime } = useI18n();
  return (
    <Card title={t('portal.historyTitle', { importer })}>
      <ul className="portal-list">
        {history.map((h, i) => (
          <li key={i} aria-current={h.current ? 'true' : undefined}>
            <div className="portal-list-main">
              <span>
                {t(`portal.kind.${h.kind}`)}
                {h.reference && ` · ${h.reference}`}
                {h.current && <span className="muted small"> · {t('portal.historyCurrent')}</span>}
              </span>
              <time className="muted small" dateTime={h.createdAt}>
                {formatDateTime(h.createdAt)}
              </time>
            </div>
            <div className="portal-list-side">
              <PortalStatusTag status={h.status} />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
