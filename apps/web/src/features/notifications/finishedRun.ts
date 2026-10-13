import type { ProgressEvent } from '../../api/types';

/** How a run ended, as far as notifications care. */
export type RunOutcome = 'extracted' | 'extractionFailed' | 'validated' | 'validationFailed';

/** A run that just ended: one document extracted (or not), or one validation stored (or not). */
export interface FinishedRun {
  outcome: RunOutcome;
  shipmentId: string;
  runId: string;
  documentId?: string;
  /** Failed runs: what went wrong. */
  error?: string;
  /** Validations: number of findings stored. */
  findings?: number;
}

/**
 * The run an event ends, or null. Only `saved` ends a run; a failed extraction the queue will retry
 * (willRetry) has not ended yet.
 */
export function finishedRun(e: ProgressEvent): FinishedRun | null {
  if (e.stage !== 'saved' || (e.status !== 'done' && e.status !== 'failed')) return null;
  const failed = e.status === 'failed';
  if (e.kind === 'extraction') {
    if (failed && e.detail.willRetry) return null;
    return {
      outcome: failed ? 'extractionFailed' : 'extracted',
      shipmentId: e.shipmentId,
      runId: e.runId,
      ...(e.documentId ? { documentId: e.documentId } : {}),
      ...(failed && e.detail.error ? { error: e.detail.error } : {}),
    };
  }
  return {
    outcome: failed ? 'validationFailed' : 'validated',
    shipmentId: e.shipmentId,
    runId: e.runId,
    ...(failed && e.detail.error ? { error: e.detail.error } : {}),
    ...(!failed && e.detail.findings !== undefined ? { findings: e.detail.findings } : {}),
  };
}

/** Same run, same ending: a second copy of it is a duplicate. */
export const finishedKey = (run: FinishedRun): string => `${run.runId}:${run.outcome}`;
