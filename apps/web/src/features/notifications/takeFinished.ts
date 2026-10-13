import type { ProgressEvent } from '../../api/types';
import { finishedKey, finishedRun, type FinishedRun } from './finishedRun';

/**
 * The run to tell about, or null: only a live event (after the stream's `ready`, never the backlog
 * replayed on connection) that ends a run not told yet. Remembers it in `seen`.
 */
export function takeFinished(event: ProgressEvent, live: boolean, seen: Set<string>): FinishedRun | null {
  if (!live) return null;
  const run = finishedRun(event);
  if (!run) return null;
  const key = finishedKey(run);
  if (seen.has(key)) return null;
  seen.add(key);
  return run;
}
