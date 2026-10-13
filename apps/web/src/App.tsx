import { Tooltip } from 'radix-ui';
import { AppFooter } from './components/layout/AppFooter';
import { AppHeader } from './components/layout/AppHeader';
import { PageBoundary } from './components/layout/PageBoundary';
import { RouteView } from './components/layout/RouteView';
import { useRoute } from './hooks/useRoute';
import { routeKey } from './lib/routeKey';

export function App() {
  const route = useRoute();
  return (
    <Tooltip.Provider delayDuration={300}>
      <AppHeader route={route} />
      <main className="app-main">
        <PageBoundary key={routeKey(route)}>
          <RouteView route={route} />
        </PageBoundary>
      </main>
      <AppFooter />
    </Tooltip.Provider>
  );
}
