import { CopyIcon, Link2Icon } from '@radix-ui/react-icons';
import { useCallback, useEffect, useState } from 'react';
import { linkAddress, portalApi, type PortalRequestDetail } from '../../api/portal';
import type { ThreadDetail } from '../../api/types';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import type { MessageKey } from '../../i18n/keys';
import { useI18n } from '../../i18n/useI18n';
import { errorMessage } from '../../lib/errorMessage';
import { PortalStatusTag } from './PortalStatusTag';
import { useOrg } from '../team/useOrg';

type PortalEvent = PortalRequestDetail['events'][number];

/**
 * The supplier portal of a conversation, for the importer: where the request stands, the link (copy,
 * replace, turn off), closing it, and what the supplier did with it.
 */
export function PortalPanel({ thread, readOnly: demo, refreshKey }: { thread: ThreadDetail; readOnly: boolean; refreshKey: number }) {
  const { t, formatDateTime } = useI18n();
  // Making, copying and stopping links needs shipment.write (the API checks again).
  const readOnly = demo || !useOrg().can('shipment.write');
  const [request, setRequest] = useState<PortalRequestDetail | null>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { items } = await portalApi.requests({ threadId: thread.id, limit: 1 });
      setRequest(items[0] ? await portalApi.request(items[0].id) : null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [thread.id]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const act = async (work: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await work();
      await load();
      if (done) setNotice(done);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const copy = (id: string) =>
    act(async () => {
      const link = await portalApi.link(id);
      await navigator.clipboard.writeText(linkAddress(link));
    }, t('portal.copied'));

  const canHave = thread.kind === 'correction_request' && !!thread.shipmentId;
  if (request === undefined || (request === null && !canHave)) return null;

  if (request === null) {
    return (
      <Card title={t('portal.panelTitle')}>
        <p className="muted">{t('portal.none')}</p>
        {error && <Banner tone="error">{error}</Banner>}
        {!readOnly && (
          <Button disabled={busy} onClick={() => void act(() => portalApi.forThread(thread.id))}>
            <Link2Icon aria-hidden /> {t('portal.enable')}
          </Button>
        )}
      </Card>
    );
  }

  const active = request.links.find((l) => l.active);
  const closed = request.status === 'closed';
  return (
    <Card title={t('portal.panelTitle')} aside={<PortalStatusTag status={request.status} importer />}>
      <p className="muted small">{t('portal.panelText')}</p>
      {error && <Banner tone="error">{error}</Banner>}
      {notice && <Banner tone="ok">{notice}</Banner>}
      <p className="small">{active ? t('portal.linkUntil', { date: formatDateTime(active.expiresAt) }) : t('portal.noLink')}</p>
      {!readOnly && (
        <div className="portal-actions">
          {active && (
            <Button size="sm" disabled={busy} onClick={() => void copy(request.id)}>
              <CopyIcon aria-hidden /> {t('portal.copy')}
            </Button>
          )}
          {!closed && (
            <Button size="sm" disabled={busy} onClick={() => void act(() => portalApi.newLink(request.id), t('portal.newLinkDone'))}>
              {t('portal.newLink')}
            </Button>
          )}
          {active && (
            <Button size="sm" disabled={busy} onClick={() => void act(() => portalApi.revoke(request.id))}>
              {t('portal.revoke')}
            </Button>
          )}
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act(() => portalApi.close(request.id, !closed))}>
            {closed ? t('portal.reopenRequest') : t('portal.closeRequest')}
          </Button>
        </div>
      )}
      <h3 className="portal-activity-title">{t('portal.activity')}</h3>
      {request.events.length === 0 ? (
        <p className="muted small">{t('portal.noActivity')}</p>
      ) : (
        <ul className="portal-activity">
          {request.events.map((e, i) => (
            <li key={i}>
              <span>{eventText(t, e)}</span>
              <time className="muted small" dateTime={e.createdAt}>
                {formatDateTime(e.createdAt)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function eventText(t: (key: MessageKey, vars?: Record<string, string | number>) => string, e: PortalEvent): string {
  const reason = e.reason ? t(`portal.reasons.${e.reason}` as MessageKey) : '';
  switch (e.kind) {
    case 'opened':
      return t('portal.event.opened', { count: e.count ?? 1 });
    case 'uploaded':
      return t('portal.event.uploaded', { files: (e.files ?? []).join(', ') });
    case 'checked':
      return e.findings === undefined ? t('portal.event.checkFailed') : t('portal.event.checked', { count: e.findings });
    case 'link_revoked':
    case 'upload_refused':
    case 'denied':
      return t(`portal.event.${e.kind}`, { reason });
    default:
      return t(`portal.event.${e.kind}`);
  }
}
