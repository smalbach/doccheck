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

  /** Paced runs report one update at a time, so waits add up even for updates sent without awaiting (rules). */
  private paceChain: Promise<void> = Promise.resolve();

  /**
   * Reports one update. Resolves once it is queued for publishing (after the demo pacing wait, if any:
   * then updates wait in line, and the time spent in line is added to the duration).
   */
  readonly report = (update: UpdateOf<DetailOf<K>>): Promise<void> => {
    if (!this.paced) return this.send(update, 0);
    const calledAt = Date.now();
    const turn = this.paceChain.then(async () => {
      const wait = pacingFor(this.scope.kind, update.stage, update.status, (update.detail ?? {}) as Record<string, unknown>);
      if (wait) await sleep(wait);
      await this.send(update, Date.now() - calledAt);
    });
    this.paceChain = turn.catch(() => undefined);
    return turn;
  };

  private async send(update: UpdateOf<DetailOf<K>>, wait: number): Promise<void> {
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
    } as NewProgressEvent);
  }

  /** Shorthand for a stage reported in one go (an instant marker, a skip, the final save). */
  emit(update: UpdateOf<DetailOf<K>>): Promise<void> {
    return this.report(update);
  }

  /**
   * The run failed: every stage still open fails with the error, then `final` fails, so a run always
   * ends with a `saved` event (done or failed) whatever stage the error came from.
   */
  async fail(err: unknown, final: UpdateOf<DetailOf<K>>['stage'], detail: Record<string, unknown> = {}): Promise<void> {
    // Updates still waiting in line (paced runs) may open stages: let them through first.
    await this.paceChain;
    const error = errorText(err);
    const now = Date.now();
    const finalStarted = this.open.get(final);
    for (const [stage, started] of [...this.open.entries()].filter(([stage]) => stage !== final)) {
      await this.report({ stage, status: 'failed', durationMs: now - started, detail: { error } } as UpdateOf<DetailOf<K>>);
    }
    await this.report({ stage: final, status: 'failed', durationMs: finalStarted === undefined ? 0 : now - finalStarted, detail: { ...detail, error } } as UpdateOf<DetailOf<K>>);
  }
}
