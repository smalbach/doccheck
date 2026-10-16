import { DownloadIcon } from '@radix-ui/react-icons';
import { useState } from 'react';
import { teamApi } from '../../api/teamClient';
import type { AuditRow } from '../../api/teamTypes';
import { LoadingCard } from '../../components/layout/LoadingCard';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { EmptyState } from '../../components/ui/EmptyState';
import { Field } from '../../components/ui/Field';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pager } from '../../components/ui/Pager';
import { Select } from '../../components/ui/Select';
import { TextInput } from '../../components/ui/TextInput';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useQuery } from '../../hooks/useQuery';
import { useI18n } from '../../i18n/useI18n';
import { errorMessage } from '../../lib/errorMessage';

const PAGE = 50;
/** Action prefixes to filter by; '' is every action. */
const ACTIONS = ['', 'shipment.', 'finding.', 'comment.', 'member.', 'org.', 'auth.', 'retention.', 'mail.', 'http.'] as const;
type ActionFilter = (typeof ACTIONS)[number] | 'all';

const short = (value: unknown) => {
  if (value === undefined || value === null) return '';
  const text = JSON.stringify(value);
  return text.length > 160 ? `${text.slice(0, 160)}…` : text;
};

/** Every write in the organization, newest first: filters, CSV export, and a check of the hash chain. */
export function AuditPage() {
  const { t, formatDateTime } = useI18n();
  const [action, setAction] = useState<ActionFilter>('all');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [offset, setOffset] = useState(0);
  const search = useDebouncedValue(q.trim(), 300);
  const query = { action: action === 'all' ? undefined : action, q: search || undefined, from: from || undefined, to: to || undefined, limit: PAGE, offset };
  const { data, error, loading } = useQuery(JSON.stringify(query), () => teamApi.audit(query));
  const [verify, setVerify] = useState<{ intact: boolean; rows: number; firstBroken: number | null }>();
  const [verifyError, setVerifyError] = useState<string>();
  if (!data) return <LoadingCard error={error} />;

  const filter = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setOffset(0);
  };
  const columns: Column<AuditRow>[] = [
    { key: 'at', header: t('team.audit.at'), cell: (r) => <span className="nowrap">{formatDateTime(r.at)}</span> },
    { key: 'user', header: t('team.audit.user'), cell: (r) => r.userEmail ?? <span className="muted">{t('team.audit.system')}</span> },
    { key: 'action', header: t('team.audit.action'), cell: (r) => <code className="mono">{r.action}</code> },
    { key: 'entity', header: t('team.audit.entity'), cell: (r) => <span className="mono small">{[r.entity, r.entityId].filter(Boolean).join(' ')}</span>, secondary: true },
    {
      key: 'change',
      header: t('team.audit.change'),
      cell: (r) => (
        <span className="audit-change small">
          {r.before !== undefined && (
            <span>
              <span className="muted">{t('team.audit.before')}</span> {short(r.before)}
            </span>
          )}
          {r.after !== undefined && (
            <span>
              <span className="muted">{t('team.audit.after')}</span> {short(r.after)}
            </span>
          )}
        </span>
      ),
    },
    { key: 'ip', header: t('team.audit.ip'), cell: (r) => <span className="muted small">{r.ip}</span>, secondary: true },
  ];
  return (
    <div className="page">
      <PageHeader
        title={t('team.audit.title')}
        description={t('team.audit.text')}
        actions={
          <>
            <Button
              onClick={() =>
                void teamApi.verifyAudit().then(
                  (v) => {
                    setVerify(v);
                    setVerifyError(undefined);
                  },
                  (err: unknown) => setVerifyError(errorMessage(err)),
                )
              }
            >
              {t('team.audit.verify')}
            </Button>
            <Button asChild>
              <a href={teamApi.auditCsvUrl(query)} download>
                <DownloadIcon aria-hidden /> {t('team.audit.csv')}
              </a>
            </Button>
          </>
        }
      />
      {verifyError && <Banner tone="error">{verifyError}</Banner>}
      {verify && (
        <Banner tone={verify.intact ? 'ok' : 'error'}>
          {verify.intact ? t('team.audit.intact', { count: verify.rows }) : t('team.audit.broken', { id: String(verify.firstBroken) })}
        </Banner>
      )}
      <Card>
        <div className="filters">
          <Select<ActionFilter>
            value={action}
            options={ACTIONS.map((a) => ({ value: a === '' ? 'all' : a, label: a === '' ? t('team.audit.allActions') : a.replace(/\.$/, '') }))}
            onValueChange={filter(setAction)}
            ariaLabel={t('team.audit.action')}
          />
          <div className="filters-right">
            <Field label={t('team.audit.from')}>{(id) => <TextInput id={id} type="date" value={from} onChange={(e) => filter(setFrom)(e.target.value)} />}</Field>
            <Field label={t('team.audit.to')}>{(id) => <TextInput id={id} type="date" value={to} onChange={(e) => filter(setTo)(e.target.value)} />}</Field>
            <TextInput type="search" value={q} onChange={(e) => filter(setQ)(e.target.value)} placeholder={t('team.audit.search')} aria-label={t('team.audit.search')} />
          </div>
        </div>
        {error && <Banner tone="error">{error}</Banner>}
        <p className="visually-hidden" role="status">
          {loading ? t('common.loading') : t('team.audit.matching', { count: data.total })}
        </p>
        <div aria-busy={loading} className={loading ? 'is-refreshing' : undefined}>
          {data.items.length === 0 ? <EmptyState title={t('team.audit.empty')} /> : <DataTable columns={columns} rows={data.items} rowKey={(r) => String(r.id)} compact caption={t('team.audit.title')} />}
        </div>
        <Pager offset={data.offset} limit={data.limit} total={data.total} onOffsetChange={setOffset} label={t('team.audit.pages')} busy={loading} />
      </Card>
    </div>
  );
}
