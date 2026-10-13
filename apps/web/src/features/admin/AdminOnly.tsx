import type { ReactNode } from 'react';
import { useAuth } from '../auth/useAuth';
import { ForbiddenPage } from './ForbiddenPage';

/** Hides admin pages from other users (the API refuses them with 403 regardless). */
export function AdminOnly({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  return user?.role === 'admin' ? <>{children}</> : <ForbiddenPage />;
}
