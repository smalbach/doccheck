import type { FinishedRun, RunOutcome } from './finishedRun';

/** Runs told in one notification: same shipment, same outcome ("3 documents of CA-014 extracted"). */
export interface RunGroup {
  key: string;
  outcome: RunOutcome;
  shipmentId: string;
  /** In the order they ended, without duplicates. */
  runs: FinishedRun[];
}

/** Extractions of a shipment group together; each validation stands alone. */
export function groupKey(run: FinishedRun): string {
  const base = `${run.shipmentId}:${run.outcome}`;
  return run.outcome === 'extracted' || run.outcome === 'extractionFailed' ? base : `${base}:${run.runId}`;
}

/** Groups a burst of finished runs, in the order the first run of each group ended. */
export function groupRuns(runs: readonly FinishedRun[]): RunGroup[] {
  const groups = new Map<string, RunGroup>();
  for (const run of runs) {
    const key = groupKey(run);
    const group = groups.get(key);
    if (!group) groups.set(key, { key, outcome: run.outcome, shipmentId: run.shipmentId, runs: [run] });
    else if (!group.runs.some((r) => r.runId === run.runId)) group.runs.push(run);
  }
  return [...groups.values()];
}

/**
 * A group with the runs of the one told shortly before under the same key, so a document finishing
 * a few seconds after the others updates "2 documents extracted" to "3" instead of adding a toast.
 */
export function mergeGroup(previous: RunGroup | undefined, group: RunGroup): RunGroup {
  if (!previous || previous.key !== group.key) return group;
  const runs = [...previous.runs, ...group.runs.filter((r) => !previous.runs.some((p) => p.runId === r.runId))];
  return { ...group, runs };
}
