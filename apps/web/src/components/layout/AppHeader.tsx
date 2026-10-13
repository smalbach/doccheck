import type { Route } from '../../hooks/useRoute';
import { NavLink } from './NavLink';

export function AppHeader({ route }: { route: Route }) {
  return (
    <header className="app-header">
      <a href="#/" className="brand">
        <span className="logo" aria-hidden>
          ✓
        </span>
        DocCheck
      </a>
      <span className="tagline">Freight documents checked before they reach CBSA or CBP</span>
      <nav className="nav" aria-label="Main">
        <NavLink href="#/" active={route.name !== 'results'}>
          Shipments
        </NavLink>
        <NavLink href="#/results" active={route.name === 'results'}>
          Results
        </NavLink>
      </nav>
    </header>
  );
}
