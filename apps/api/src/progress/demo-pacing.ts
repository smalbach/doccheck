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
  // agent: per answered question (progress event with an answer), not on the stage's end.
  validation: { rules: 700, citations: 500, agent: 1800 },
};

/** How long the model takes to "write" a cached answer in the demo (LlmClient.replayMs). */
export const DEMO_REPLAY_MS = 2500;

export const demoPacing = (env: NodeJS.ProcessEnv = process.env) => isDemo(env) && env.DEMO_PACING !== 'false';

/** How long to wait before reporting this update (0 = no wait). */
export function pacingFor(kind: ProgressKind, stage: string, status: ProgressStatus, answered: boolean): number {
  const ms = PACING_MS[kind][stage] ?? 0;
  if (kind === 'validation' && stage === 'agent') return status === 'progress' && answered ? ms : 0;
  return status === 'done' ? ms : 0;
}
