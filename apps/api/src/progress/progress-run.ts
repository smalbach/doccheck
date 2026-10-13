import { errorText, STAGE_END, type ExtractionDetail, type NewProgressEvent, type ProgressKind, type UpdateOf, type ValidationDetail } from '@doccheck/schemas';
import { setTimeout as sleep } from 'node:timers/promises';
import { pacingFor } from './demo-pacing';

export type DetailOf<K extends ProgressKind> = K extends 'extraction' ? ExtractionDetail : ValidationDetail;

export interface RunScope<K extends ProgressKind> {
  kind: K;
  shipmentId: string;
  /** Extraction runs: the document. */
  documentId?: string;
  runId: string;
}

/**
 * One extraction or validation run as it reports progress. `report` is the ProgressCallback handed to
 * the packages: it stamps each update with the run's ids and the time, and publishes it (in order,
 * in the background). The run remembers which stages are open so `fail` can close them on an error
 * thrown outside any stage.
 */
export class ProgressRun<K extends ProgressKind> {
  private readonly open = new Map<string, number>();

  constructor(
    readonly scope: RunScope<K>,
    private readonly publish: (event: NewProgressEvent) => Promise<unknown>,
    private readonly paced = false,
  ) {}

  get runId() {
    return this.scope.runId;
  }

  /** Reports one update. Resolves once it is queued for publishing (after the demo pacing wait, if any). */
  readonly report = async (update: UpdateOf<DetailOf<K>>): Promise<void> => {
    const answered = !!update.detail && 'answer' in update.detail && !!update.detail.answer;
    const wait = this.paced ? pacingFor(this.scope.kind, update.stage, update.status, answered) : 0;
    if (wait) await sleep(wait);
    const at = Date.now();
    // The validation's `started` stage is an instant marker: it never ends, so it is not tracked as open.
    if (update.status === 'started' && !(this.scope.kind === 'validation' && update.stage === 'started')) this.open.set(update.stage, at);
    if (STAGE_END.includes(update.status)) this.open.delete(update.stage);
    const durationMs = update.durationMs === undefined ? undefined : update.durationMs + wait;
    void this.publish({
      ...this.scope,
      stage: update.stage,
      status: update.status,
      at: new Date(at).toISOString(),
      ...(durationMs === undefined ? {} : { durationMs }),
      detail: update.detail ?? {},
      ...(update.ephemeral ? { ephemeral: true } : {}),
    } as NewProgressEvent);
  };

  /** Shorthand for a stage reported in one go (an instant marker, a skip, the final save). */
  emit(update: UpdateOf<DetailOf<K>>): Promise<void> {
    return this.report(update);
  }

  /**
   * The run failed: every stage still open fails with the error, then `final` fails, so a run always
   * ends with a `saved` event (done or failed) whatever stage the error came from.
   */
  async fail(err: unknown, final: UpdateOf<DetailOf<K>>['stage'], detail: Record<string, unknown> = {}): Promise<void> {
    const error = errorText(err);
    const now = Date.now();
    const finalStarted = this.open.get(final);
    for (const [stage, started] of [...this.open.entries()].filter(([stage]) => stage !== final)) {
      await this.report({ stage, status: 'failed', durationMs: now - started, detail: { error } } as UpdateOf<DetailOf<K>>);
    }
    await this.report({ stage: final, status: 'failed', durationMs: finalStarted === undefined ? 0 : now - finalStarted, detail: { ...detail, error } } as UpdateOf<DetailOf<K>>);
  }
}
