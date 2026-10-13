import type { ProgressEvent } from '../api/types';
import type { MessageKey, MessageVars } from '../i18n/keys';

export interface Announcement {
  key: MessageKey;
  vars?: MessageVars;
  /** Milliseconds to format into vars.duration, when the message has one. */
  durationMs?: number;
}

/**
 * What a screen reader hears for a live event, or null. Only milestones: a document going to the model
 * and ending, a validation starting, reaching the agent and ending; never a rule, an OCR page or a question.
 * `runMs` is the validation's duration so far (for "finished in 41 s").
 */
export function progressAnnouncement(e: ProgressEvent, fileName: string | undefined, runMs: number): Announcement | null {
  if (e.kind === 'extraction') {
    const file = fileName ?? '';
    if (e.stage === 'extracting' && e.status === 'started') return { key: 'progress.announce.extracting', vars: { file } };
    if (e.stage === 'saved' && e.status === 'done') return { key: 'progress.announce.extracted', vars: { file } };
    if (e.stage === 'saved' && e.status === 'failed' && !e.detail.willRetry) return { key: 'progress.announce.failed', vars: { file } };
    return null;
  }
  if (e.stage === 'started') return { key: 'progress.announce.validationStarted' };
  if (e.stage === 'agent' && e.status === 'started' && (e.detail.total ?? 0) > 0) return { key: 'progress.announce.agent', vars: { count: e.detail.total ?? 0 } };
  if (e.stage === 'saved' && e.status === 'done') return { key: 'progress.announce.validationDone', durationMs: runMs };
  if (e.stage === 'saved' && e.status === 'failed') return { key: 'progress.announce.validationFailed' };
  return null;
}
