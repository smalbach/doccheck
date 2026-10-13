import { Disclosure } from '../../components/ui/Disclosure';
import { useI18n } from '../../i18n/useI18n';
import { formatDuration } from '../../lib/formatDuration';
import type { LiveOutput } from '../../lib/liveOutput';
import { runDuration, type RunTimeline } from '../../lib/progressTimeline';
import { LiveOutputPanel } from './LiveOutputPanel';
import { RunSteps } from './RunSteps';

/** Stages worth naming in the one-line summary of a finished extraction (where the time goes). */
const HIGHLIGHTS = ['ocr', 'extracting'] as const;

/**
 * The extraction of a document: its steps while it runs; once finished, one line ("Extracted in 32 s ·
 * OCR 4.2 s · Model 28 s") that expands to the steps. While the model writes, its answer shows below the
 * steps (`output`).
 */
export function DocumentProgress({ run, fileName, output }: { run: RunTimeline; fileName: string; output?: LiveOutput }) {
  const i18n = useI18n();
  const { t } = i18n;
  const label = t('progress.steps', { file: fileName });
  if (run.state === 'running') {
    return (
      <div className="run-steps">
        <RunSteps run={run} label={label} />
        {output && output.runId === run.runId && <LiveOutputPanel output={output} fileName={fileName} />}
      </div>
    );
  }
  const total = formatDuration(runDuration(run), i18n);
  const highlights = HIGHLIGHTS.flatMap((stage) => {
    const ms = run.steps[stage]?.durationMs;
    return ms === undefined ? [] : [t('progress.highlight', { stage: t(`progress.stages.${stage}`), duration: formatDuration(ms, i18n) })];
  });
  const summary = [run.state === 'done' ? t('progress.extractedIn', { duration: total }) : t('progress.failedAfter', { duration: total }), ...highlights].join(' · ');
  return (
    <div className="run-steps">
      <Disclosure
        summary={
          <span>
            {summary}
            <span className="visually-hidden"> ({fileName})</span>
          </span>
        }
      >
        <RunSteps run={run} label={label} />
      </Disclosure>
    </div>
  );
}
