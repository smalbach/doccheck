import type { ProgressEvent } from '../api/types';
import type { MessageKey, MessageVars } from '../i18n/keys';
import { runName, splitActivity, type ActivityNames, type ActivityState } from './activity';

/**
 * What a screen reader hears for a live event of the user-wide stream, or null. Only milestones: a
 * run starting ("2 tasks running") and a run ending (extracted, failed, cancelled, validated). `state`
 * already has the event applied.
 */
export function activityAnnouncement(e: ProgressEvent, state: ActivityState, names: ActivityNames): { key: MessageKey; vars?: MessageVars } | null {
  const starts = (e.kind === 'extraction' && e.stage === 'queued' && e.status === 'started' && e.detail.reason !== 'retry') || (e.kind === 'validation' && e.stage === 'started');
  if (starts) return { key: 'activity.announce.running', vars: { count: Math.max(1, splitActivity(state).running.length) } };
  if (e.stage !== 'saved' || (e.status !== 'done' && e.status !== 'failed') || e.detail.willRetry) return null;
  const run = state.runs[e.runId];
  const name = run ? runName(run, names).full : '';
  if (e.kind === 'validation') return { key: e.status === 'done' ? 'activity.announce.validated' : 'activity.announce.validationFailed', vars: { name } };
  if (e.status === 'done') return { key: 'activity.announce.extracted', vars: { name } };
  return { key: e.detail.reason === 'cancelled' ? 'activity.announce.cancelled' : 'activity.announce.failed', vars: { name } };
}
