import type { ReactNode } from 'react';
import { cx } from '../../lib/cx';

export interface BannerProps {
  tone: 'error' | 'warning' | 'ok' | 'info';
  children: ReactNode;
}

export function Banner({ tone, children }: BannerProps) {
  return (
    <p className={cx('banner', `banner-${tone}`)} role={tone === 'error' ? 'alert' : 'status'}>
      {children}
    </p>
  );
}
