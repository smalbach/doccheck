import { useEffect, useState } from 'react';

export type Route = { name: 'home' } | { name: 'results' } | { name: 'shipment'; id: string };

const SHIPMENT = /^#\/s\/([0-9a-f-]{36})/i;

function parse(hash: string): Route {
  const id = SHIPMENT.exec(hash)?.[1];
  if (id) return { name: 'shipment', id };
  return hash.startsWith('#/results') ? { name: 'results' } : { name: 'home' };
}

/** Hash routes: "#/" home, "#/s/<id>" a shipment, "#/results" the evaluation. No router needed for three screens. */
export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parse(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
