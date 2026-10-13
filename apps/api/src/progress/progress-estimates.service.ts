import { Inject, Injectable } from '@nestjs/common';
import type { LlmProvider } from '@doccheck/extraction';
import type { ProgressEstimates, StageEstimate } from '@doccheck/schemas';
import { isDemo } from '../demo/demo-mode';
import { LLM_PROVIDER } from '../llm/llm.module';
import { ProgressRepository, type DurationRow } from './progress.repository';

/** Estimates are computed at most this often. */
const CACHE_MS = 60_000;
/** History they are computed from (progress events are kept 7 days by default). */
const DAYS = 7;
/** The model call's history from llm_calls, when progress events have too little of it. */
const LLM_CALL_DAYS = 30;
/** Below this many samples a source is not preferred over another. */
const ENOUGH = 3;

/**
 * Typical stage durations on this server (GET /events/estimates), for "about 40 s left" in the
 * activity panel. Medians of the recent progress events; the model call per model from calls that
 * really ran the model (progress events, else llm_calls). Shared by every user (no shipment data,
 * durations only) and cached for a minute.
 */
@Injectable()
export class ProgressEstimatesService {
  private cached?: { at: number; value: Promise<ProgressEstimates> };

  constructor(
    private readonly repo: ProgressRepository,
    @Inject(LLM_PROVIDER) private readonly provider: LlmProvider,
  ) {}

  get(now = Date.now()): Promise<ProgressEstimates> {
    if (!this.cached || now - this.cached.at > CACHE_MS) {
      const value = this.compute();
      this.cached = { at: now, value };
      // A failed computation is not kept: the next call tries again.
      value.catch(() => (this.cached = undefined));
    }
    return this.cached.value;
  }

  private async compute(): Promise<ProgressEstimates> {
    const [rows, items, calls] = await Promise.all([this.repo.stageDurations(DAYS), this.repo.perItemDurations(DAYS), this.repo.modelCallDurations(LLM_CALL_DAYS)]);
    return { ...buildEstimates(rows, calls, isDemo()), ...items, model: this.provider.id, computedAt: new Date().toISOString() };
  }
}

const estimate = (r: { samples: number; ms: number }): StageEstimate => ({ ms: Math.max(0, Math.round(r.ms)), samples: r.samples });

/** Combines several medians into one, weighted by their samples. */
function merge(parts: { samples: number; ms: number }[]): StageEstimate | undefined {
  const samples = parts.reduce((n, p) => n + p.samples, 0);
  return samples ? estimate({ samples, ms: parts.reduce((t, p) => t + p.ms * p.samples, 0) / samples }) : undefined;
}

/**
 * Stage estimates from the grouped durations. The model call of each model: calls that ran the model,
 * from progress events when there are enough of them, else from llm_calls. A cached answer takes
 * milliseconds and says nothing about the next real call, except in the read-only demo (`replay`),
 * where every answer is cached and paced: there only cached calls count.
 */
export function buildEstimates(rows: DurationRow[], calls: { model: string; samples: number; ms: number }[], replay = false): Pick<ProgressEstimates, 'extraction' | 'validation' | 'models'> {
  const extraction: ProgressEstimates['extraction'] = {};
  const validation: ProgressEstimates['validation'] = {};
  const models: ProgressEstimates['models'] = {};
  const byStage = new Map<string, DurationRow[]>();
  for (const r of rows) {
    if (r.kind === 'extraction' && r.stage === 'extracting') continue;
    const key = `${r.kind}/${r.stage}`;
    byStage.set(key, [...(byStage.get(key) ?? []), r]);
  }
  for (const [key, parts] of byStage) {
    const [kind, stage] = key.split('/');
    const value = merge(parts);
    if (!value) continue;
    if (kind === 'extraction') extraction[stage as keyof typeof extraction] = value;
    else validation[stage as keyof typeof validation] = value;
  }
  const modelCalls = rows.filter((r) => r.kind === 'extraction' && r.stage === 'extracting' && r.model && r.cached === replay);
  const modelIds = new Set([...modelCalls.map((r) => r.model), ...(replay ? [] : calls.map((c) => c.model))]);
  for (const model of modelIds) {
    const events = merge(modelCalls.filter((r) => r.model === model));
    const logged = replay ? undefined : calls.find((c) => c.model === model);
    const pick = [events, logged && estimate(logged)].find((e) => e && e.samples >= ENOUGH) ?? events ?? (logged && estimate(logged));
    if (pick) models[model] = pick;
  }
  const current = Object.values(models);
  if (current.length) extraction.extracting = merge(current);
  return { extraction, validation, models };
}
