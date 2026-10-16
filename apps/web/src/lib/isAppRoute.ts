import type { AppRoute, Route } from './parseRoute';

const PUBLIC = new Set(['landing', 'login', 'register', 'forgot-password', 'reset-password', 'portal']);

/** Routes inside the signed-in app (sidebar layout); the rest are public pages. */
export function isAppRoute(route: Route): route is AppRoute {
  return !PUBLIC.has(route.name);
}
