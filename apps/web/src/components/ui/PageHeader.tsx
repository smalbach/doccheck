import type { ReactNode } from 'react';

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** Buttons at the right. */
  actions?: ReactNode;
  /** Above the title, e.g. a back link. */
  eyebrow?: ReactNode;
}

export function PageHeader({ title, description, actions, eyebrow }: PageHeaderProps) {
  return (
    <div className="page-header">
      <div className="page-header-text">
        {eyebrow}
        <h1>{title}</h1>
        {description && <p className="muted">{description}</p>}
      </div>
      {actions && <div className="page-header-actions">{actions}</div>}
    </div>
  );
}
