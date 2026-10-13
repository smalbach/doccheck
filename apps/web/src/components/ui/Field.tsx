import { Label } from 'radix-ui';
import { useId, type ReactNode } from 'react';
import { cx } from '../../lib/cx';

export interface FieldProps {
  label: string;
  /** Receives the id to put on the control. */
  children: (id: string) => ReactNode;
  grow?: boolean;
}

/** A label above its control. */
export function Field({ label, children, grow }: FieldProps) {
  const id = useId();
  return (
    <div className={cx('field', grow && 'field-grow')}>
      <Label.Root htmlFor={id} className="field-label">
        {label}
      </Label.Root>
      {children(id)}
    </div>
  );
}
