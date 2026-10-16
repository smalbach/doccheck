import type { Route } from '../hooks/useRoute';

/** A key per page, so page state (and its error boundary) resets on navigation. */
export function routeKey(route: Route): string {
  if (route.name === 'shipment') return `shipment:${route.id}`;
  if (route.name === 'shipments') return `shipments:${route.due ?? ''}:${route.assignee ?? ''}`;
  // Another portal link opened in the same tab starts over.
  if (route.name === 'portal') return `portal:${route.token ?? ''}`;
  return route.name;
}
