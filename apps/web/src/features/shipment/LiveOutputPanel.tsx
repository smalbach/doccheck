import { useLayoutEffect, useRef, useState } from 'react';
import { Disclosure } from '../../components/ui/Disclosure';
import { useI18n } from '../../i18n/useI18n';
import type { LiveOutput } from '../../lib/liveOutput';
import { readPreference, writePreference } from '../../preferences/storage';

const OPEN_KEY = 'doccheck.liveOutput.open';
/** Within this many pixels of the bottom, the panel keeps following the text. */
const FOLLOW_SLACK_PX = 24;

/**
 * The model's answer while it writes it (JSON forming), under a document's steps. Expandable, open by
 * default (the choice is remembered). It follows the new text unless the user scrolled up, until they
 * scroll back down. Deliberately not a live region: a screen reader would read every token;
 * ProgressAnnouncer speaks the milestones instead.
 */
export function LiveOutputPanel({ output, fileName }: { output: LiveOutput; fileName: string }) {
  const { t, formatNumber } = useI18n();
  const [open, setOpen] = useState(() => readPreference(OPEN_KEY) !== 'false');
  const pre = useRef<HTMLPreElement>(null);
  const follow = useRef(true);

  useLayoutEffect(() => {
    const el = pre.current;
    if (el && follow.current) el.scrollTop = el.scrollHeight;
  }, [output.text, open]);

  const stats = [
    t('progress.output.tokens', { count: output.tokens, tokens: formatNumber(output.tokens) }),
    output.replay ? t('progress.output.replay') : output.tokensPerSecond !== undefined && t('progress.output.speed', { speed: formatNumber(output.tokensPerSecond, 0) }),
  ].filter(Boolean);

  return (
    <Disclosure
      defaultOpen={open}
      onOpenChange={(next) => {
        setOpen(next);
        writePreference(OPEN_KEY, String(next));
      }}
      summary={
        <span>
          {t('progress.output.title')}
          <span className="step-meta"> · {stats.join(' · ')}</span>
          <span className="visually-hidden"> ({fileName})</span>
        </span>
      }
    >
      <pre
        ref={pre}
        className="live-output"
        // Focusable so keyboard users can scroll it; a labelled region, not a live one.
        tabIndex={0}
        role="region"
        aria-label={t('progress.output.label', { file: fileName })}
        onScroll={(e) => {
          const el = e.currentTarget;
          follow.current = el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_SLACK_PX;
        }}
      >
        {output.start > 0 && '…'}
        {output.text}
        <span className="live-output-caret" aria-hidden />
      </pre>
    </Disclosure>
  );
}
