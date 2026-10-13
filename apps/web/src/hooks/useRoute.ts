import { useEffect, useState } from 'react';
import { parseRoute, type Route } from '../lib/parseRoute';

export type { Route };

/** The current hash route; updates on navigation. */
export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
