export type PublicRoute = { name: 'landing' } | { name: 'login'; next?: string } | { name: 'register'; next?: string };

export type AppRoute =
  | { name: 'dashboard' }
  | { name: 'shipments' }
  | { name: 'new-shipment' }
  | { name: 'shipment'; id: string }
  | { name: 'samples' }
  | { name: 'insights' }
  | { name: 'rules' }
  | { name: 'results' }
  | { name: 'account' }
  | { name: 'admin-settings' }
  | { name: 'admin-users' }
  | { name: 'admin-system' }
  | { name: 'not-found' };

export type Route = PublicRoute | AppRoute;

const SHIPMENT = /^\/(?:app\/)?s\/([0-9a-f-]{36})$/i;

const APP_PAGES: Record<string, AppRoute> = {
  '/app': { name: 'dashboard' },
  '/app/shipments': { name: 'shipments' },
  '/app/shipments/new': { name: 'new-shipment' },
  '/app/samples': { name: 'samples' },
  '/app/data': { name: 'insights' },
  '/app/rules': { name: 'rules' },
  '/app/results': { name: 'results' },
  // Links from before the app moved under /app.
  '/results': { name: 'results' },
  '/app/account': { name: 'account' },
  '/app/admin': { name: 'admin-settings' },
  '/app/admin/settings': { name: 'admin-settings' },
  '/app/admin/users': { name: 'admin-users' },
  '/app/admin/system': { name: 'admin-system' },
};

/**
 * "#/" landing, "#/login" and "#/register" (with ?next=<path>), everything else under "#/app".
 * Old links ("#/s/<id>", "#/results") still open their page.
 */
export function parseRoute(hash: string): Route {
  const [rawPath = '', query = ''] = hash.replace(/^#/, '').split('?');
  const path = rawPath.replace(/\/+$/, '') || '/';
  const next = new URLSearchParams(query).get('next') ?? undefined;
  if (path === '/') return { name: 'landing' };
  if (path === '/login') return { name: 'login', next };
  if (path === '/register') return { name: 'register', next };
  const id = SHIPMENT.exec(path)?.[1];
  if (id) return { name: 'shipment', id };
  return APP_PAGES[path] ?? { name: 'not-found' };
}
