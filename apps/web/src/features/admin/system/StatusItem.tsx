import type { ReactNode } from 'react';
import { cx } from '../../../lib/cx';

export interface StatusItemProps {
  label: string;
  children: ReactNode;
  tone?: 'ok' | 'error';
}

export function StatusItem({ label, children, tone }: StatusItemProps) {
  return (
    <div className="status-item">
      <dt>{label}</dt>
      <dd className={cx(tone && `status-item-${tone}`)}>{children}</dd>
    </div>
  );
}
