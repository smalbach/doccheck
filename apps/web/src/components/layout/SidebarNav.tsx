import { NAVIGATION } from '../../constants/navigation';
import type { AppRoute } from '../../lib/parseRoute';
import { SidebarLink } from './SidebarLink';

export interface SidebarNavProps {
  route: AppRoute;
  demo: boolean;
  onNavigate?: () => void;
}

export function SidebarNav({ route, demo, onNavigate }: SidebarNavProps) {
  return (
    <nav className="sidebar-nav" aria-label="App">
      {NAVIGATION.map((group) => (
        <div key={group.label} className="sidebar-group">
          <p className="sidebar-group-label">{group.label}</p>
          {group.items
            .filter((item) => !(demo && item.writes))
            .map((item) => (
              <SidebarLink key={item.href} item={item} active={item.matches.includes(route.name)} onNavigate={onNavigate} />
            ))}
        </div>
      ))}
    </nav>
  );
}
