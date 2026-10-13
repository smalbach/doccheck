import type { ReactNode } from 'react';
import { cx } from '../../lib/cx';

export interface StatTileProps {
  label: string;
  value: number;
  href?: string;
  tone?: 'neutral' | 'attention' | 'ok';
  hint?: ReactNode;
}

/** A count on the dashboard; links to the matching list when `href` is set. */
export function StatTile({ label, value, href, tone = 'neutral', hint }: StatTileProps) {
  const body = (
    <>
      <span className="stat-tile-value">{value}</span>
      <span className="stat-tile-label">{label}</span>
      {hint && <span className="muted small">{hint}</span>}
    </>
  );
  const className = cx('stat-tile', `stat-tile-${tone}`);
  return href ? (
    <a className={className} href={href}>
      {body}
    </a>
  ) : (
    <div className={className}>{body}</div>
  );
}
