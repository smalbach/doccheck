import type { ProgressEvent } from '../../api/types';
import { finishedRun } from './finishedRun';

/** Runs under way: run id → time of its latest event (ms). */
export type RunningRuns = ReadonlyMap<string, number>;

/** A run with no news for this long is not counted (its end was lost, e.g. the server restarted). */
export const STALE_RUN_MS = 30 * 60_000;

/** The runs under way after an event: its run is running until its `saved` ends it. */
export function trackRun(running: RunningRuns, e: ProgressEvent): RunningRuns {
  const next = new Map(running);
  if (finishedRun(e)) next.delete(e.runId);
  else next.set(e.runId, Date.parse(e.at) || 0);
  return next;
}

/** Runs under way that had news recently. */
export function countRunning(running: RunningRuns, now: number): number {
  let count = 0;
  for (const at of running.values()) if (now - at < STALE_RUN_MS) count += 1;
  return count;
}

/** "(2) DocCheck" while runs are under way, "✓ DocCheck" when one ended while the tab was hidden. */
export function pageTitle(base: string, running: number, doneInBackground: boolean): string {
  if (running > 0) return `(${running}) ${base}`;
  return doneInBackground ? `✓ ${base}` : base;
}
