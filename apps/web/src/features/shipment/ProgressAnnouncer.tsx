import { useEffect, useState } from 'react';
import type { ProgressEvent, ShipmentDocument } from '../../api/types';
import { useI18n } from '../../i18n/useI18n';
import { formatDuration } from '../../lib/formatDuration';
import { progressAnnouncement } from '../../lib/progressAnnouncement';
import { runDuration, type ProgressState } from '../../lib/progressTimeline';

export interface ProgressAnnouncerProps {
  /** The latest live event. */
  event?: ProgressEvent;
  progress: ProgressState;
  documents: ReadonlyMap<string, ShipmentDocument>;
}

/** A polite live region that says when a document or a validation reaches a milestone (see progressAnnouncement). */
export function ProgressAnnouncer({ event, progress, documents }: ProgressAnnouncerProps) {
  const i18n = useI18n();
  const [message, setMessage] = useState('');
  const validation = progress.validation;

  // Only a new event speaks: a re-render with the same one must not repeat it.
  useEffect(() => {
    if (!event) return;
    const runMs = validation && validation.runId === event.runId ? runDuration(validation) : 0;
    const a = progressAnnouncement(event, event.documentId ? documents.get(event.documentId)?.fileName : undefined, runMs);
    if (!a) return;
    setMessage(i18n.t(a.key, { ...a.vars, ...(a.durationMs !== undefined ? { duration: formatDuration(a.durationMs, i18n) } : {}) }));
  }, [event]);

  return (
    <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
      {message}
    </div>
  );
}
