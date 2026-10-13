import { Tooltip } from 'radix-ui';
import { AppShell } from './components/layout/AppShell';
import { PageBoundary } from './components/layout/PageBoundary';
import { PublicRouteView } from './components/layout/PublicRouteView';
import { RouteView } from './components/layout/RouteView';
import { AuthProvider } from './features/auth/AuthProvider';
import { useRoute } from './hooks/useRoute';
import { isAppRoute } from './lib/isAppRoute';
import { routeKey } from './lib/routeKey';

export function App() {
  const route = useRoute();
  return (
    <AuthProvider>
      <Tooltip.Provider delayDuration={300}>
        {isAppRoute(route) ? (
          <AppShell route={route}>
            <PageBoundary key={routeKey(route)}>
              <RouteView route={route} />
            </PageBoundary>
          </AppShell>
        ) : (
          <PageBoundary key={routeKey(route)}>
            <PublicRouteView route={route} />
          </PageBoundary>
        )}
      </Tooltip.Provider>
    </AuthProvider>
  );
}
