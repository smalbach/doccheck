import { Suspense } from 'react';
import type { AppRoute } from '../../lib/parseRoute';
import { LoadingCard } from './LoadingCard';
import { RoutePage } from './RoutePage';

/** The page of an app route (inside the sidebar layout), with a loading card while a lazy page downloads. */
export function RouteView({ route }: { route: AppRoute }) {
  return (
    <Suspense fallback={<LoadingCard />}>
      <RoutePage route={route} />
    </Suspense>
  );
}
