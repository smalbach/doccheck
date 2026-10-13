import { Stepper, type StepperItem } from '../../components/ui/Stepper';
import { useNow } from '../../hooks/useNow';
import type { MessageKey } from '../../i18n/keys';
import { useI18n } from '../../i18n/useI18n';
import { formatDuration } from '../../lib/formatDuration';
import { stepsOf } from '../../lib/progressSteps';
import type { RunTimeline } from '../../lib/progressTimeline';

/** Running steps show their elapsed time once it is worth showing. */
const SHOW_ELAPSED_AFTER_MS = 2000;

/** The stepper of an extraction or validation run: each stage with its state, hint and duration. */
export function RunSteps({ run, label }: { run: RunTimeline; label: string }) {
  const i18n = useI18n();
  const { t } = i18n;
  const now = useNow(run.state === 'running');
  const items: StepperItem[] = stepsOf(run).map((step) => {
    const elapsed = step.startedAt ? now - Date.parse(step.startedAt) : 0;
    const duration = step.durationMs !== undefined ? step.durationMs : elapsed >= SHOW_ELAPSED_AFTER_MS ? elapsed : undefined;
    const meta = [step.note && t(step.note.key, step.note.vars), duration !== undefined && formatDuration(duration, i18n)].filter(Boolean).join(' · ');
    return {
      key: step.stage,
      label: t(`progress.stages.${step.stage}` as MessageKey),
      display: step.display,
      stateLabel: t(`progress.display.${step.display}`),
      meta: meta || undefined,
      error: step.error,
    };
  });
  return <Stepper items={items} label={label} />;
}
