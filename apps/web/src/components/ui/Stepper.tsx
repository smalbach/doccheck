import { CheckIcon, Cross2Icon, MinusIcon } from '@radix-ui/react-icons';
import type { ReactNode } from 'react';
import type { StepDisplay } from '../../lib/progressSteps';

export interface StepperItem {
  key: string;
  label: ReactNode;
  display: StepDisplay;
  /** Words for the state, read by screen readers (the marker is only visual). */
  stateLabel: string;
  /** After the label: duration, page 2 of 3, 15/15… */
  meta?: ReactNode;
  /** Shown under the stepper for a failed step. */
  error?: string;
}

const MARKERS: Record<StepDisplay, ReactNode> = {
  pending: <span className="step-dot" />,
  running: <span className="spinner step-spinner" />,
  done: <CheckIcon />,
  failed: <Cross2Icon />,
  skipped: <MinusIcon />,
};

/**
 * A compact row of steps, each pending, in progress (spinner), done, failed or skipped. Not a live
 * region: whoever renders it announces changes, sparingly.
 */
export function Stepper({ items, label }: { items: readonly StepperItem[]; label: string }) {
  const errors = items.filter((i) => i.display === 'failed' && i.error);
  return (
    <>
      <ol className="stepper" aria-label={label}>
        {items.map((item) => (
          <li key={item.key} className={`step step-${item.display}`} aria-current={item.display === 'running' ? 'step' : undefined}>
            <span className="step-marker" aria-hidden>
              {MARKERS[item.display]}
            </span>
            <span className="step-label">{item.label}</span>
            {item.meta && <span className="step-meta">{item.meta}</span>}
            <span className="visually-hidden">({item.stateLabel})</span>
          </li>
        ))}
      </ol>
      {errors.map((i) => (
        <p key={i.key} className="step-error error small">
          {i.label}: {i.error}
        </p>
      ))}
    </>
  );
}
