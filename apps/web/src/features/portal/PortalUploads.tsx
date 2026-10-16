import type { PortalUpload } from '../../api/portal';
import { Card } from '../../components/ui/Card';
import { Tag } from '../../components/ui/Tag';
import { useI18n } from '../../i18n/useI18n';

/** The supplier's uploads to this request, newest first, with how each was checked. */
export function PortalUploads({ uploads }: { uploads: readonly PortalUpload[] }) {
  const { t, formatDateTime } = useI18n();
  return (
    <Card title={t('portal.uploadsTitle')}>
      <ul className="portal-list">
        {uploads.map((u) => (
          <li key={u.id}>
            <div className="portal-list-main">
              <span className="portal-files">{u.files.join(', ')}</span>
              <time className="muted small" dateTime={u.createdAt}>
                {formatDateTime(u.createdAt)}
              </time>
            </div>
            <div className="portal-list-side">
              <Tag tone={u.status === 'validated' ? 'ok' : 'neutral'}>{t(`portal.uploadStatus.${u.status}`)}</Tag>
              {u.status === 'validated' && u.findings !== undefined && <span className="small">{t('portal.uploadFindings', { count: u.findings })}</span>}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
