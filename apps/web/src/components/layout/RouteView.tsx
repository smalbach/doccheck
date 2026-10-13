import { HomePage } from '../../features/home/HomePage';
import { ResultsPage } from '../../features/results/ResultsPage';
import { ShipmentPage } from '../../features/shipment/ShipmentPage';
import type { Route } from '../../hooks/useRoute';

export function RouteView({ route }: { route: Route }) {
  switch (route.name) {
    case 'shipment':
      return <ShipmentPage id={route.id} />;
    case 'results':
      return <ResultsPage />;
    case 'home':
      return <HomePage />;
  }
}
