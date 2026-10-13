import { Slot } from 'radix-ui';
import type { ComponentPropsWithRef } from 'react';
import { cx } from '../../lib/cx';

export type ButtonVariant = 'default' | 'primary' | 'danger' | 'link' | 'ghost';

export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  variant?: ButtonVariant;
  size?: 'md' | 'sm';
  /** Render the child element (e.g. a link) with the button's styles. */
  asChild?: boolean;
}

export function Button({ variant = 'default', size = 'md', asChild = false, className, type = 'button', ...props }: ButtonProps) {
  const Component = asChild ? Slot.Root : 'button';
  return <Component type={asChild ? undefined : type} className={cx('btn', `btn-${variant}`, size === 'sm' && 'btn-sm', className)} {...props} />;
}
