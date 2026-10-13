import type { ReactNode } from 'react';

export interface EmptyStateProps {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ title, children, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <p className="empty-state-title">{title}</p>
      {children && <p className="muted">{children}</p>}
      {action}
    </div>
  );
}
