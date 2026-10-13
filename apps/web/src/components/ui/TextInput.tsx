import type { ComponentPropsWithRef } from 'react';
import { cx } from '../../lib/cx';

export function TextInput({ className, ...props }: ComponentPropsWithRef<'input'>) {
  return <input className={cx('input', className)} {...props} />;
}
