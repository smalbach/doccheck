import { useState } from 'react';
import { api } from '../../api/client';
import type { ProgressEstimates } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { useI18n } from '../../i18n/useI18n';
import { activityDoing, activityOutcome, queuePosition, remainingMs, runName, type ActivityNames, type ActivityRun } from '../../lib/activity';
import { cx } from '../../lib/cx';
import { errorMessage } from '../../lib/errorMessage';
import { formatDuration } from '../../lib/formatDuration';
import { runDuration } from '../../lib/progressTimeline';

/** Below this, "a few seconds left" instead of a number. */
const FEW_SECONDS_MS = 10_000;

export interface ActivityItemProps {
  run: ActivityRun;
  /** Every run known, for the place in line. */
  runs: readonly ActivityRun[];
  names: ActivityNames;
  now: number;
  /** Running runs only: typical stage durations, for the time left. */
  estimates?: ProgressEstimates;
  /** Offer to cancel a running extraction (not in the read-only demo). */
  canCancel?: boolean;
  onNavigate: () => void;
}

/** One run of the activity panel: "CA-014 · invoice.pdf", what it does now (or how it ended), a link to the shipment. */
export function ActivityItem({ run, runs, names, now, estimates, canCancel = false, onNavigate }: ActivityItemProps) {
  const i18n = useI18n();
  const { t } = i18n;
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string>();
  const { timeline } = run;
  const name = runName(run, names);
  const title = timeline.kind === 'extraction' ? name.full : `${name.shipment} · ${t('activity.validation')}`;
  const running = timeline.state === 'running';

  let status: string;
  let tone: string | undefined;
  if (running) {
    const doing = activityDoing(timeline, queuePosition(run, runs));
    const text = t(doing.key, doing.vars);
    status = doing.since ? t('activity.elapsed', { doing: text, duration: formatDuration(Math.max(0, now - Date.parse(doing.since)), i18n) }) : text;
    const left = remainingMs(timeline, estimates, now);
    if (left !== undefined) status += ` · ${left < FEW_SECONDS_MS ? t('activity.fewSecondsLeft') : t('activity.left', { duration: formatDuration(roundLeft(left), i18n) })}`;
  } else {
    const outcome = activityOutcome(timeline, runDuration(timeline));
    status = t(outcome.key, { ...outcome.vars, ...(outcome.durationMs !== undefined ? { duration: formatDuration(outcome.durationMs, i18n) } : {}) });
    tone = outcome.tone;
  }

  const cancel = () => {
    if (!timeline.documentId) return;
    setCancelling(true);
    setCancelError(undefined);
    api.cancelExtraction(run.shipmentId, timeline.documentId).then(
      // The run ends through the stream; the button stays disabled until then.
      () => undefined,
      (e: unknown) => {
        setCancelling(false);
        setCancelError(errorMessage(e));
      },
    );
  };

  return (
    <li className="activity-item">
      <div className="activity-item-main">
        <a className="activity-item-title" href={`#/app/s/${run.shipmentId}`} onClick={onNavigate}>
          {title}
        </a>
        <span className={cx('activity-item-status', tone && `activity-${tone}`)}>{status}</span>
        {cancelError && (
          <span className="activity-item-error" role="alert">
            {t('activity.cancelError', { message: cancelError })}
          </span>
        )}
      </div>
      {running && canCancel && timeline.kind === 'extraction' && timeline.documentId && (
        <Button size="sm" variant="ghost" onClick={cancel} disabled={cancelling} aria-label={cancelling ? undefined : t('activity.cancelLabel', { name: name.full })}>
          {cancelling ? t('activity.cancelling') : t('activity.cancel')}
        </Button>
      )}
    </li>
  );
}

/** A time left that does not jitter every second: to 5 s under a minute, to 15 s above. */
function roundLeft(ms: number): number {
  const step = ms < 60_000 ? 5000 : 15_000;
  return Math.max(step, Math.round(ms / step) * step);
}
