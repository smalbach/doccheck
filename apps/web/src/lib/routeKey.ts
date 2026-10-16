import type { Route } from '../hooks/useRoute';

/** A key per page, so page state (and its error boundary) resets on navigation. */
export function routeKey(route: Route): string {
  if (route.name === 'shipment' || route.name === 'review-document') return `${route.name}:${route.id}`;
  return route.name;
}
