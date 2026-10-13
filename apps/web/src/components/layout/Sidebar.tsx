import type { User } from '../../api/types';
import { useI18n } from '../../i18n/useI18n';
import type { AppRoute } from '../../lib/parseRoute';
import { Tag } from '../ui/Tag';
import { Brand } from './Brand';
import { LanguageSelect } from './LanguageSelect';
import { ThemeToggle } from './ThemeToggle';
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
  const { t } = useI18n();
  return (
    <div className="sidebar">
      <div className="sidebar-top">
        <Brand href="#/app" />
        {demo && <Tag tone="accent">{t('app.readOnlyDemo')}</Tag>}
      </div>
      <SidebarNav route={route} demo={demo} onNavigate={onNavigate} />
      <div className="sidebar-prefs">
        <LanguageSelect />
        <ThemeToggle />
      </div>
      <div className="sidebar-bottom">
        <UserMenu user={user} onSignOut={onSignOut} />
      </div>
    </div>
  );
}
