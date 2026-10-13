import type { ReactNode } from 'react';
import { cx } from '../../lib/cx';

export interface TagProps {
  tone?: 'neutral' | 'ok' | 'accent';
  children: ReactNode;
}

export function Tag({ tone = 'neutral', children }: TagProps) {
  return <span className={cx('tag', tone !== 'neutral' && `tag-${tone}`)}>{children}</span>;
}
