import { useEffect, useState } from 'react';
import { analyticsApi, type RegulationChange, type RegulationCheck } from '../../api/analytics';
import { LoadingCard } from '../../components/layout/LoadingCard';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { PageHeader } from '../../components/ui/PageHeader';
import { Tag } from '../../components/ui/Tag';
import { useQuery } from '../../hooks/useQuery';
import { useI18n } from '../../i18n/useI18n';
import { errorMessage } from '../../lib/errorMessage';
import { ruleLabel } from '../../lib/ruleLabel';
import { useAuth } from '../auth/useAuth';
import { notifyRegulationsRead } from '../../hooks/useRegulationsUnread';

/** What changed in the cited regulations since the last checks, the rules citing it and the open shipments concerned. */
export function RegulationsPage() {
  const { t, formatDateTime } = useI18n();
  const isAdmin = useAuth().user?.role === 'admin';
  const [version, setVersion] = useState(0);
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string }>();
  const { data, error } = useQuery(`regulations:${version}`, () => analyticsApi.regulations());
  const unread = data?.unread ?? 0;
  useEffect(() => {
    // Opening the page reads the changes; the "New" tags stay until the next visit.
    if (unread > 0) void analyticsApi.markRegulationsRead().then(notifyRegulationsRead, () => undefined);
  }, [unread]);

  const check = async () => {
    setChecking(true);
    setNotice(undefined);
    try {
      const c = await analyticsApi.checkRegulations();
      setNotice({ tone: 'ok', text: c.baseline ? t('analytics.regulations.baseline') : t('analytics.regulations.checked', { count: c.changes, documents: c.documents }) });
      setVersion((v) => v + 1);
    } catch (e) {
      setNotice({ tone: 'error', text: errorMessage(e) });
    } finally {
      setChecking(false);
    }
  };

  const last = data?.checks[0];
  const when = last ? formatDateTime(last.finishedAt ?? last.startedAt) : t('analytics.regulations.never');
  return (
    <div className="page">
      <PageHeader
        title={t('analytics.regulations.title')}
        description={t('analytics.regulations.description')}
        actions={
          isAdmin && (
            <Button onClick={() => void check()} disabled={checking}>
              {checking ? t('analytics.regulations.checking') : t('analytics.regulations.checkNow')}
            </Button>
          )
        }
      />
      <div aria-live="polite">{notice && <Banner tone={notice.tone}>{notice.text}</Banner>}</div>
      {!data ? (
        <LoadingCard error={error} />
      ) : (
        <>
          <p className="muted small">
            {data.intervalHours ? t('analytics.regulations.schedule', { hours: data.intervalHours, when }) : t('analytics.regulations.scheduleOff', { when })}
            {last && <CheckErrors check={last} />}
          </p>
          {data.changes.length === 0 ? (
            <Card>
              <EmptyState title={t('analytics.regulations.none')}>{t('analytics.regulations.noneText')}</EmptyState>
            </Card>
          ) : (
            <>
              {unread > 0 && <p className="small">{t('analytics.regulations.unread', { count: unread })}</p>}
              <ul className="regulation-list">
                {data.changes.map((c) => (
                  <li key={c.id}>
                    <ChangeCard change={c} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}

function CheckErrors({ check }: { check: RegulationCheck }) {
  const { t } = useI18n();
  if (!check.errors.length) return null;
  return <span className="block">{t('analytics.regulations.errors', { list: check.errors.map((e) => `${e.id} (${e.error})`).join('; ') })}</span>;
}

function ChangeCard({ change: c }: { change: RegulationChange }) {
  const { t, formatDateTime } = useI18n();
  const section = c.section.split(' > ').pop() || c.title;
  return (
    <Card
      className="regulation-change"
      title={
        <>
          {section} <span className="muted small">· {c.title}</span>
        </>
      }
      aside={
        <span className="tag-list">
          {c.unread && <Tag tone="accent">{t('analytics.regulations.newTag')}</Tag>}
          <Tag>{t(`analytics.regulations.kind.${c.kind}`)}</Tag>
        </span>
      }
    >
      <p className="muted small">
        {t('analytics.regulations.detected', { when: formatDateTime(c.detectedAt) })}
        {c.effectiveBefore !== c.effectiveAfter && c.effectiveAfter && ` · ${t('analytics.regulations.effective', { before: c.effectiveBefore ?? '—', after: c.effectiveAfter })}`}
        {' · '}
        <a href={c.url} target="_blank" rel="noreferrer">
          {t('analytics.regulations.source')}
        </a>
      </p>
      <div className="regulation-diff">
        {c.before !== undefined && (
          <figure>
            <figcaption className="field-label">{t('analytics.regulations.before')}</figcaption>
            <del className="regulation-text">{c.before}</del>
          </figure>
        )}
        {c.after !== undefined && (
          <figure>
            <figcaption className="field-label">{t('analytics.regulations.after')}</figcaption>
            <ins className="regulation-text">{c.after}</ins>
          </figure>
        )}
      </div>
      <div className="analytics-grid">
        <section>
          <h3 className="section-title">{t('analytics.regulations.rules')}</h3>
          {c.rules.length ? (
            <ul className="plain-list small">
              {c.rules.map((r) => (
                <li key={`${r.destination}:${r.ruleId}`}>
                  <strong>{r.destination}</strong> · {ruleLabel(t, r.ruleId)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">{t('analytics.regulations.noRules')}</p>
          )}
        </section>
        <section>
          <h3 className="section-title">{t('analytics.regulations.affected')}</h3>
          {c.affected.length ? (
            <ul className="plain-list small">
              {c.affected.map((a) => (
                <li key={a.shipmentId}>
                  <a href={`#/app/s/${a.shipmentId}`}>{a.reference ?? a.shipmentId.slice(0, 8)}</a> <span className="mono">{a.ruleIds.join(', ')}</span>
                  {a.citesPassage && <> · <Tag tone="accent">{t('analytics.regulations.citesPassage')}</Tag></>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">{t('analytics.regulations.noAffected')}</p>
          )}
        </section>
      </div>
    </Card>
  );
}
