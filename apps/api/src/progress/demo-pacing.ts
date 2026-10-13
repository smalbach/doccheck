import type { ProgressKind, ProgressStatus } from '@doccheck/schemas';
import { isDemo } from '../demo/demo-mode';

/**
 * The read-only demo replays model answers from a cache, so a stage that takes 30 s with a real model
 * ends in milliseconds and the live timeline flashes by. There, each stage below waits this long
 * before reporting its end (the wait is part of its duration), so visitors see what the app does.
 * Only with DEMO_READONLY=true, and DEMO_PACING=false turns it off.
 */
const PACING_MS: Record<ProgressKind, Partial<Record<string, number>>> = {
  // extracting: no wait at the end; the cached answer is replayed as a stream instead (DEMO_REPLAY_MS).
  extraction: { reading: 500, ocr: 800, classifying: 300, normalizing: 300 },
  // agent: per answered question (progress event with an answer); its end waits AGENT_SETTLE_MS.
  validation: { rules: 300, citations: 300, agent: 1800 },
};

/** How long the model takes to "write" a cached answer in the demo (LlmClient.replayMs). */
export const DEMO_REPLAY_MS = 2500;

/**
 * Validation steps paced on their progress events, so findings appear one rule at a time: each rule
 * (longer when it found something, so the eye catches the new card) and each regulation quote.
 */
const RULE_MS = 150;
const RULE_FOUND_MS = 350;
const CITATION_MS = 350;
const AGENT_SETTLE_MS = 1200;

export const demoPacing = (env: NodeJS.ProcessEnv = process.env) => isDemo(env) && env.DEMO_PACING !== 'false';

/** How long to wait before reporting this update (0 = no wait). `detail` is the update's. */
export function pacingFor(kind: ProgressKind, stage: string, status: ProgressStatus, detail: Record<string, unknown> = {}): number {
  const ms = PACING_MS[kind][stage] ?? 0;
  if (kind === 'validation' && status === 'progress') {
    if (stage === 'agent') return detail.answer ? ms : 0;
    if (stage === 'rules') return RULE_MS + (typeof detail.findings === 'number' && detail.findings > 0 ? RULE_FOUND_MS : 0);
    if (stage === 'citations') return CITATION_MS;
    return 0;
  }
  // The last answer stays on screen a moment before the run is saved and the panel folds.
  if (kind === 'validation' && stage === 'agent') return status === 'done' ? AGENT_SETTLE_MS : 0;
  return status === 'done' ? ms : 0;
}
