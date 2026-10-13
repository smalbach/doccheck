import { Toast } from 'radix-ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProgressEvent } from '../../api/types';
import { useI18n } from '../../i18n/useI18n';
import { navigate } from '../../lib/navigate';
import { useActivityEvents } from '../activity/ActivityContext';
import { backgroundNotifyAllowed, showBrowserNotification } from './browserNotifications';
import { createBatcher } from './createBatcher';
import type { FinishedRun } from './finishedRun';
import { groupRuns, mergeGroup, type RunGroup } from './groupRuns';
import { loadGroupInfo } from './loadGroupInfo';
import { notificationText, type GroupInfo } from './notificationText';
import { notifyTargets } from './notifyTargets';
import { RunToast } from './RunToast';
import { countRunning, pageTitle, trackRun, type RunningRuns } from './runningRuns';
import { takeFinished } from './takeFinished';

/** Toasts on screen at once; an older one leaves when a fourth arrives. */
const MAX_TOASTS = 3;
const TOAST_MS = 6000;
/** A burst: runs ending within this of each other are told together (at most MAX_BATCH_MS after the first). */
const QUIET_MS = 1200;
const MAX_BATCH_MS = 4000;
/** A run ending this soon after a group was told joins it ("2 documents" becomes "3"). */
const MERGE_MS = TOAST_MS + 2000;
/** Lets the closing animation play before the toast leaves the list. */
const EXIT_MS = 300;

interface ShownToast {
  id: number;
  group: RunGroup;
  info: GroupInfo;
}

/**
 * Tells the signed-in user when runs of their shipments end, from the app's one user-wide stream
 * (ActivityProvider, GET /events; it must be rendered inside it): a toast (unless the shipment's page
 * is open) and, opted in and in the background, a browser notification. Only live events count, never
 * the backlog replayed on connection. Also counts running tasks in the tab title.
 */
export function RunNotifications({ watchingShipmentId }: { watchingShipmentId?: string }) {
  const i18n = useI18n();
  const [toasts, setToasts] = useState<ShownToast[]>([]);
  const [running, setRunning] = useState<RunningRuns>(() => new Map());
  const [doneInBackground, setDoneInBackground] = useState(false);

  // Read when a batch is told, not when it began.
  const watching = useRef(watchingShipmentId);
  const t = useRef(i18n.t);
  useEffect(() => {
    watching.current = watchingShipmentId;
    t.current = i18n.t;
  });

  const seen = useRef(new Set<string>());
  const recent = useRef(new Map<string, { group: RunGroup; until: number }>());
  const nextId = useRef(1);

  const tell = useCallback(async (group: RunGroup) => {
    const targets = notifyTargets(group, {
      ...(watching.current ? { watchingShipmentId: watching.current } : {}),
      visible: document.visibilityState === 'visible',
      backgroundAllowed: backgroundNotifyAllowed(),
    });
    if (!targets.toast && !targets.browser) return;
    const info = await loadGroupInfo(group);
    if (targets.toast) {
      const shown: ShownToast = { id: nextId.current++, group, info };
      setToasts((list) => [...list.filter((x) => x.group.key !== group.key), shown].slice(-MAX_TOASTS));
    }
    if (targets.browser) {
      const text = notificationText(group, info, t.current);
      showBrowserNotification(text.title, { ...(text.body ? { body: text.body } : {}), tag: group.key, onClick: () => navigate(`/app/s/${group.shipmentId}`) });
    }
  }, []);

  const [batcher] = useState(() =>
    createBatcher<FinishedRun>(
      (runs) => {
        const now = Date.now();
        for (const [key, r] of recent.current) if (r.until < now) recent.current.delete(key);
        for (const burst of groupRuns(runs)) {
          const group = mergeGroup(recent.current.get(burst.key)?.group, burst);
          recent.current.set(group.key, { group, until: now + MERGE_MS });
          void tell(group);
        }
      },
      { quietMs: QUIET_MS, maxMs: MAX_BATCH_MS },
    ),
  );
  useEffect(() => () => batcher.cancel(), [batcher]);

  const onEvent = useCallback(
    (event: ProgressEvent, live: boolean) => {
      setRunning((r) => trackRun(r, event));
      const run = takeFinished(event, live, seen.current);
      if (!run) return;
      if (document.visibilityState === 'hidden') setDoneInBackground(true);
      batcher.add(run);
    },
    [batcher],
  );
  useActivityEvents(onEvent);

  // "(2) DocCheck" while tasks run, "✓ DocCheck" after one ended in the background, until the tab is seen.
  const baseTitle = useRef(document.title);
  useEffect(() => {
    document.title = pageTitle(baseTitle.current, countRunning(running, Date.now()), doneInBackground);
  }, [running, doneInBackground]);
  useEffect(() => {
    const base = baseTitle.current;
    const onVisible = () => {
      if (document.visibilityState === 'visible') setDoneInBackground(false);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      document.title = base;
    };
  }, []);

  const remove = (id: number) => setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), EXIT_MS);

  return (
    <Toast.Provider duration={TOAST_MS} swipeDirection="right" label={i18n.t('notify.label')}>
      {toasts.map((x) => (
        <RunToast key={x.id} group={x.group} info={x.info} onClosed={() => remove(x.id)} />
      ))}
      <Toast.Viewport className="toast-viewport" label={i18n.t('notify.region')} />
    </Toast.Provider>
  );
}
