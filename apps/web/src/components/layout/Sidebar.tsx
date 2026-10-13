import type { User } from '../../api/types';
import type { AppRoute } from '../../lib/parseRoute';
import { Tag } from '../ui/Tag';
import { Brand } from './Brand';
import { SidebarNav } from './SidebarNav';
import { UserMenu } from './UserMenu';

export interface SidebarProps {
  route: AppRoute;
  user: User;
  demo: boolean;
  onSignOut: () => void;
  /** Closes the mobile drawer after picking a page. */
  onNavigate?: () => void;
}

export function Sidebar({ route, user, demo, onSignOut, onNavigate }: SidebarProps) {
  return (
    <div className="sidebar">
      <div className="sidebar-top">
        <Brand href="#/app" />
        {demo && <Tag tone="accent">read-only demo</Tag>}
      </div>
      <SidebarNav route={route} demo={demo} onNavigate={onNavigate} />
      <div className="sidebar-bottom">
        <UserMenu user={user} onSignOut={onSignOut} />
      </div>
    </div>
  );
}
