import { Tooltip } from 'radix-ui';
import { AppShell } from './components/layout/AppShell';
import { PageBoundary } from './components/layout/PageBoundary';
import { PublicRouteView } from './components/layout/PublicRouteView';
import { RouteView } from './components/layout/RouteView';
import { AuthProvider } from './features/auth/AuthProvider';
import { OrgProvider } from './features/team/OrgProvider';
import { I18nProvider } from './i18n/I18nProvider';
import type { Locale } from './i18n/locales';
import type { Messages } from './i18n/messages/en';
import { ThemeProvider } from './preferences/ThemeProvider';
import { useRoute } from './hooks/useRoute';
import { isAppRoute } from './lib/isAppRoute';
import { routeKey } from './lib/routeKey';

export function App({ initialLocale, initialMessages }: { initialLocale: Locale; initialMessages: Messages }) {
  const route = useRoute();
  return (
    <I18nProvider initialLocale={initialLocale} initialMessages={initialMessages}>
      <ThemeProvider>
        <AuthProvider>
          <OrgProvider>
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
          </OrgProvider>
        </AuthProvider>
      </ThemeProvider>
    </I18nProvider>
  );
}
