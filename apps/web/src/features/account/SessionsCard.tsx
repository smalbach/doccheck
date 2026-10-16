import { useState } from 'react';
import { teamApi } from '../../api/teamClient';
import type { SessionInfo } from '../../api/teamTypes';
import { LoadingCard } from '../../components/layout/LoadingCard';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Tag } from '../../components/ui/Tag';
import { useQuery } from '../../hooks/useQuery';
import { useI18n } from '../../i18n/useI18n';
import { errorMessage } from '../../lib/errorMessage';

/** "Firefox on macOS" from a user agent, roughly; the raw string is in the tooltip. */
function device(ua?: string): string {
  if (!ua) return '—';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : ua.split(/[\s/]/)[0];
  const os = /Windows/.test(ua) ? 'Windows' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} · ${os}` : (browser ?? '—');
}

/** Every device signed in to the account, with the one in use marked; any other can be signed out. */
export function SessionsCard() {
  const { t, formatDateTime } = useI18n();
  const [version, setVersion] = useState(0);
  const { data, error } = useQuery(`sessions:${version}`, teamApi.sessions);
  const [actionError, setActionError] = useState<string>();
  if (!data) return <LoadingCard error={error} />;
  const columns: Column<SessionInfo>[] = [
    {
      key: 'device',
      header: t('team.sessions.device'),
      cell: (s) => (
        <span title={s.userAgent}>
          {device(s.userAgent)} {s.current && <Tag tone="ok">{t('team.sessions.current')}</Tag>}
        </span>
      ),
    },
    { key: 'method', header: t('team.sessions.method'), cell: (s) => t(`team.sessions.methods.${s.method}`), secondary: true },
    { key: 'ip', header: t('team.audit.ip'), cell: (s) => <span className="muted small">{s.ip ?? '—'}</span>, secondary: true },
    { key: 'seen', header: t('team.sessions.lastSeen'), cell: (s) => <span className="muted">{formatDateTime(s.lastSeenAt)}</span> },
    {
      key: 'actions',
      header: <span className="visually-hidden">{t('admin.columns.actions')}</span>,
      cell: (s) =>
        s.current ? null : (
          <Button
            size="sm"
            variant="ghost"
            aria-label={t('team.sessions.revokeOne', { device: device(s.userAgent) })}
            onClick={() => void teamApi.revokeSession(s.id).then(() => setVersion((v) => v + 1), (err: unknown) => setActionError(errorMessage(err)))}
          >
            {t('team.sessions.revoke')}
          </Button>
        ),
    },
  ];
  return (
    <Card title={t('team.sessions.title')}>
      <p className="muted">{t('team.sessions.text')}</p>
      {actionError && <Banner tone="error">{actionError}</Banner>}
      <DataTable columns={columns} rows={data} rowKey={(s) => s.id} caption={t('team.sessions.title')} />
    </Card>
  );
}
