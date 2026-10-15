import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { ThreadDetail, Validation } from '../../api/types';
import { BackLink } from '../../components/layout/BackLink';
import { LoadingCard } from '../../components/layout/LoadingCard';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { PageHeader } from '../../components/ui/PageHeader';
import { useDemo } from '../../hooks/useDemo';
import { refreshMailSummary } from '../../hooks/useMailSummary';
import { useI18n } from '../../i18n/useI18n';
import { errorMessage } from '../../lib/errorMessage';
import { ThreadFindings } from './ThreadFindings';
import { IntakePanel } from './IntakePanel';
import { MessageItem } from './MessageItem';
import { ReplyBox } from './ReplyBox';
import { ThreadTags } from './ThreadTags';

/** Fast while a message is on its way out, slow otherwise (replies arrive every minute at most). */
const FAST_MS = 2000;
const SLOW_MS = 30_000;

/** One conversation: every email in order, its attachments, the findings it is about, and the reply box. */
export function ThreadPage({ id }: { id: string }) {
  const { t, formatDateTime } = useI18n();
  const demo = useDemo();
  const [thread, setThread] = useState<ThreadDetail>();
  const [validation, setValidation] = useState<Validation>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const load = useCallback(async () => {
    try {
      let next = await api.mailThread(id);
      if (next.unread > 0 && !demo) {
        next = await api.readThread(id);
        refreshMailSummary();
      }
      setThread(next);
      setError(undefined);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [id, demo]);

  useEffect(() => {
    void load();
  }, [load]);
  const pending = thread?.items.some((m) => m.status === 'queued' || m.status === 'sending') || thread?.intakes?.some((i) => i.status === 'extracting' || i.status === 'validating');
  useEffect(() => {
    const timer = setInterval(() => void load(), pending ? FAST_MS : SLOW_MS);
    return () => clearInterval(timer);
  }, [load, pending]);
  const shipmentId = thread?.shipmentId;
  useEffect(() => {
    if (!shipmentId || !thread?.fingerprints.length) return;
    api.validation(shipmentId).then(setValidation, () => setValidation(undefined));
  }, [shipmentId, thread?.fingerprints.length]);

  const act = async (work: () => Promise<ThreadDetail>) => {
    try {
      setThread(await work());
      setError(undefined);
      refreshMailSummary();
    } catch (err) {
      setError(errorMessage(err));
      throw err;
    }
  };

  const back = <BackLink href="#/app/inbox" label={t('mail.back')} />;
  if (!thread) {
    return (
      <div className="page">
        {back}
        <LoadingCard error={error} />
      </div>
    );
  }
  const closed = thread.status === 'closed';
  return (
    <div className="page">
      <PageHeader
        eyebrow={back}
        title={thread.subject}
        description={
          <span className="thread-meta">
            <ThreadTags thread={thread} />
            <span className="muted small">{t(`mail.kind.${thread.kind}`)}</span>
            {thread.shipmentId && <a href={`#/app/s/${thread.shipmentId}`}>{t('mail.shipment', { reference: thread.shipmentReference ?? thread.shipmentId.slice(0, 8) })}</a>}
            {thread.partyId && <a href={`#/app/companies/${thread.partyId}`}>{thread.partyName ?? t('mail.company')}</a>}
            {thread.dueAt && !closed && <span className="muted small">{t('mail.due', { date: formatDateTime(thread.dueAt) })}</span>}
          </span>
        }
        actions={
          !demo && (
            <Button onClick={() => void act(() => api.setThreadStatus(id, closed ? 'awaiting' : 'closed')).catch(() => undefined)}>{closed ? t('mail.reopen') : t('mail.close')}</Button>
          )
        }
      />
      {error && <Banner tone="error">{error}</Banner>}
      {notice && <Banner tone="ok">{notice}</Banner>}
      {thread.intakes && <IntakePanel intakes={thread.intakes} readOnly={demo} onChanged={() => void load()} onError={setError} />}
      {thread.fingerprints.length > 0 && thread.shipmentId && <ThreadFindings fingerprints={thread.fingerprints} validation={validation} />}
      <Card>
        <ol className="mail-thread">
          {thread.items.map((m) => (
            <li key={m.id}>
              <MessageItem
                message={m}
                shipmentId={thread.shipmentId}
                readOnly={demo}
                onRetry={(messageId) => void act(() => api.retryMessage(messageId)).catch(() => undefined)}
                onAdded={(file) => setNotice(t('mail.addedNotice', { file }))}
                onError={setError}
              />
            </li>
          ))}
        </ol>
      </Card>
      {!demo && (
        <Card title={t('mail.replyTitle')}>
          <ReplyBox key={thread.items.length} thread={thread} onSend={(body, to) => act(() => api.replyThread(id, { body, to })).then(() => undefined)} />
        </Card>
      )}
    </div>
  );
}
