import type { Route } from '../hooks/useRoute';

/** A key per page, so page state (and its error boundary) resets on navigation. */
export function routeKey(route: Route): string {
  return route.name === 'shipment' ? `shipment:${route.id}` : route.name;
}
