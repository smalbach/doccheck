import { useEffect, type ReactNode } from 'react';
import { useAuth } from '../../features/auth/useAuth';
import { useDemo } from '../../hooks/useDemo';
import { useI18n } from '../../i18n/useI18n';
import { currentPath } from '../../lib/currentPath';
import { isAppRoute } from '../../lib/isAppRoute';
import { navigate } from '../../lib/navigate';
import { parseRoute, type AppRoute } from '../../lib/parseRoute';
import { AppFooter } from './AppFooter';
import { MobileTopbar } from './MobileTopbar';
import { SkipLink } from './SkipLink';
import { Sidebar } from './Sidebar';

/** The signed-in app: sidebar on the left, page on the right. Signed-out visitors are sent to sign in and brought back. */
export function AppShell({ route, children }: { route: AppRoute; children: ReactNode }) {
  const { user, logout } = useAuth();
  const demo = useDemo();
  const { t } = useI18n();
  useEffect(() => {
    // Only while still on an app page: signing out navigates away first, and StrictMode runs this twice.
    if (user === null && isAppRoute(parseRoute(window.location.hash))) navigate(`/login?next=${encodeURIComponent(currentPath())}`);
  }, [user]);

  if (!user)
    return (
      <div className="app-loading muted" role="status">
        {t('common.loading')}
      </div>
    );

  const signOut = () => {
    void logout().then(() => navigate('/'));
  };
  return (
    <div className="app-shell">
      <SkipLink />
      <aside className="app-sidebar">
        <Sidebar route={route} user={user} demo={demo} onSignOut={signOut} />
      </aside>
      <MobileTopbar route={route} user={user} demo={demo} onSignOut={signOut} />
      <div className="app-content">
        <main className="app-main" id="main-content" tabIndex={-1}>
          {children}
        </main>
        <AppFooter />
      </div>
    </div>
  );
}
