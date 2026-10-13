import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { ProgressEstimates } from '../../api/types';
import { useDemo } from '../../hooks/useDemo';
import { useInterval } from '../../hooks/useInterval';
import { useNow } from '../../hooks/useNow';
import { useI18n } from '../../i18n/useI18n';
import { splitActivity } from '../../lib/activity';
import { ActivityItem } from './ActivityItem';
import { useActivity } from './ActivityContext';

/** The estimates are cached a minute on the server: no point asking more often. */
const ESTIMATES_EVERY_MS = 60_000;

/** The activity panel's content: runs in progress (with elapsed time, estimate and cancel) and recently finished ones. */
export function ActivityPanel({ onNavigate }: { onNavigate: () => void }) {
  const { t } = useI18n();
  const demo = useDemo();
  const { state, names } = useActivity();
  const { running, finished } = splitActivity(state);
  const all = Object.values(state.runs);
  const now = useNow(running.length > 0);
  const [estimates, setEstimates] = useState<ProgressEstimates>();
  const loadEstimates = () => void api.progressEstimates().then(setEstimates, () => undefined);
  useEffect(loadEstimates, []);
  useInterval(loadEstimates, ESTIMATES_EVERY_MS, running.length > 0);

  return (
    <div className="activity-panel">
      <h2 className="activity-title">{t('activity.title')}</h2>
      <section aria-labelledby="activity-running">
        <h3 id="activity-running" className="activity-heading">
          {t('activity.running')}
        </h3>
        {running.length === 0 ? (
          <p className="muted activity-empty">{t('activity.idle')}</p>
        ) : (
          <ul className="activity-list">
            {running.map((run) => (
              <ActivityItem key={run.timeline.runId} run={run} runs={all} names={names} now={now} estimates={estimates} canCancel={!demo} onNavigate={onNavigate} />
            ))}
          </ul>
        )}
      </section>
      {finished.length > 0 && (
        <section aria-labelledby="activity-finished">
          <h3 id="activity-finished" className="activity-heading">
            {t('activity.finished')}
          </h3>
          <ul className="activity-list">
            {finished.map((run) => (
              <ActivityItem key={run.timeline.runId} run={run} runs={all} names={names} now={now} onNavigate={onNavigate} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
