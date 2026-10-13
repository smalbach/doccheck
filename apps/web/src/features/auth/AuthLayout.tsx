import type { ReactNode } from 'react';
import { PublicHeader } from '../../components/layout/PublicHeader';

export interface AuthLayoutProps {
  title: string;
  subtitle: ReactNode;
  children: ReactNode;
  footer: ReactNode;
}

/** A centered card for the sign-in and sign-up forms. */
export function AuthLayout({ title, subtitle, children, footer }: AuthLayoutProps) {
  return (
    <div className="public-page">
      <PublicHeader />
      <main className="auth-main">
        <div className="auth-card">
          <h1>{title}</h1>
          <p className="muted">{subtitle}</p>
          {children}
          <p className="auth-footer muted">{footer}</p>
        </div>
      </main>
    </div>
  );
}
