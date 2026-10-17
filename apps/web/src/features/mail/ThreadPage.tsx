import { ArrowLeftIcon, CubeIcon, HomeIcon, Pencil1Icon } from '@radix-ui/react-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api/client';
import type { ThreadDetail, Validation } from '../../api/types';
import { BackLink } from '../../components/layout/BackLink';
import { LoadingCard } from '../../components/layout/LoadingCard';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { useDemo } from '../../hooks/useDemo';
import { refreshMailSummary } from '../../hooks/useMailSummary';
import { useI18n } from '../../i18n/useI18n';
import { errorMessage } from '../../lib/errorMessage';
import { ThreadFindings } from './ThreadFindings';
import { IntakePanel } from './IntakePanel';
import { MessageItem } from './MessageItem';
import { ReplyBox } from './ReplyBox';
import { ThreadTags } from './ThreadTags';
import { PortalPanel } from '../portal/PortalPanel';

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
  /** Messages the user opened or closed by hand; the rest follow the default (latest, unread, failed open). */
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const [showEarlier, setShowEarlier] = useState(false);
  const [replying, setReplying] = useState(false);
  const replyRef = useRef<HTMLDivElement>(null);

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
  const items = thread.items;
  const last = items.length - 1;
  const openByDefault = (i: number) => i === last || items[i]!.status === 'failed' || (items[i]!.direction === 'in' && !items[i]!.readAt);
  const isOpen = (i: number) => toggled[items[i]!.id] ?? openByDefault(i);
  const toggle = (i: number) => setToggled((m) => ({ ...m, [items[i]!.id]: !isOpen(i) }));
  // Long conversations fold the middle, as a mail client does: the first message, "N earlier", the last two.
  const folded = !showEarlier && items.length >= 5 ? items.slice(1, -2).filter((_, k) => !isOpen(k + 1)).length : 0;
  const hidden = (i: number) => folded > 1 && i > 0 && i < last - 1 && !isOpen(i);
  const firstHidden = items.findIndex((_, i) => hidden(i));
  const allOpen = items.every((_, i) => isOpen(i));
  const setAll = (open: boolean) => {
    setShowEarlier(open);
    setToggled(Object.fromEntries(items.map((m) => [m.id, open])));
  };
  const reference = thread.shipmentId ? (thread.shipmentReference ?? thread.shipmentId.slice(0, 8)) : undefined;
  const openReply = () => {
    setReplying(true);
    requestAnimationFrame(() => {
      replyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      replyRef.current?.querySelector('textarea')?.focus();
    });
  };

  return (
    <div className="page mail-thread-page">
      <div className="mail-thread-toolbar">
        <a className="btn btn-ghost btn-sm" href="#/app/inbox" aria-label={t('mail.back')} title={t('mail.back')}>
          <ArrowLeftIcon aria-hidden /> <span className="mail-toolbar-text">{t('mail.back')}</span>
        </a>
        <span className="mail-toolbar-spacer" />
        {!demo && (
          <Button size="sm" onClick={() => void act(() => api.setThreadStatus(id, closed ? 'awaiting' : 'closed')).catch(() => undefined)}>
            {closed ? t('mail.reopen') : t('mail.close')}
          </Button>
        )}
      </div>
      <header className="mail-thread-head">
        <h1>{thread.subject}</h1>
        <div className="thread-meta">
          <ThreadTags thread={thread} />
          <span className="mail-chip">{t(`mail.kind.${thread.kind}`)}</span>
          {reference && (
            <a className="mail-chip mail-chip-link" href={`#/app/s/${thread.shipmentId}`}>
              <CubeIcon aria-hidden /> {t('mail.shipment', { reference })}
            </a>
          )}
          {thread.partyId && (
            <a className="mail-chip mail-chip-link" href={`#/app/companies/${thread.partyId}`}>
              <HomeIcon aria-hidden /> {thread.partyName ?? t('mail.company')}
            </a>
          )}
          {thread.dueAt && !closed && <span className="muted small">{t('mail.due', { date: formatDateTime(thread.dueAt) })}</span>}
        </div>
      </header>
      {error && <Banner tone="error">{error}</Banner>}
      {notice && <Banner tone="ok">{notice}</Banner>}
      <div className="mail-thread-layout">
        <div className="mail-thread-main">
          {items.length > 1 && (
            <div className="mail-thread-tools">
              <Button size="sm" variant="ghost" onClick={() => setAll(!allOpen)}>
                {allOpen ? t('mail.collapseAll') : t('mail.expandAll')}
              </Button>
            </div>
          )}
          <ol className="mail-thread">
            {items.map((m, i) => {
              if (hidden(i)) {
                return i === firstHidden ? (
                  <li key="earlier" className="mail-earlier">
                    <button type="button" onClick={() => setShowEarlier(true)}>
                      {t('mail.earlier', { count: folded })}
                    </button>
                  </li>
                ) : null;
              }
              return (
                <li key={m.id}>
                  <MessageItem
                    message={m}
                    shipmentId={thread.shipmentId}
                    readOnly={demo}
                    expanded={isOpen(i)}
                    onToggle={() => toggle(i)}
                    onRetry={(messageId) => void act(() => api.retryMessage(messageId)).catch(() => undefined)}
                    onAdded={(file) => setNotice(t('mail.addedNotice', { file }))}
                    onError={setError}
                  />
                </li>
              );
            })}
          </ol>
          {!demo &&
            (replying ? (
              <div ref={replyRef} className="mail-reply">
                <ReplyBox
                  key={thread.items.length}
                  thread={thread}
                  onSend={(body, to) =>
                    act(() => api.replyThread(id, { body, to })).then(() => {
                      setReplying(false);
                    })
                  }
                />
              </div>
            ) : (
              <div className="mail-reply-actions">
                <Button onClick={openReply}>
                  <Pencil1Icon aria-hidden /> {t('mail.replyAction')}
                </Button>
              </div>
            ))}
        </div>
        <aside className="mail-thread-aside" aria-label={t('mail.references')}>
          {thread.intakes && <IntakePanel intakes={thread.intakes} readOnly={demo} onChanged={() => void load()} onError={setError} />}
          {thread.fingerprints.length > 0 && thread.shipmentId && <ThreadFindings fingerprints={thread.fingerprints} validation={validation} />}
          <PortalPanel thread={thread} readOnly={demo} refreshKey={thread.items.length} />
        </aside>
      </div>
    </div>
  );
}
