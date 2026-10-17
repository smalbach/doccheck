import { NAVIGATION } from '../../constants/navigation';
import { NAV_PERMISSIONS, TEAM_NAVIGATION } from '../../constants/teamNavigation';
import { useNotificationCount } from '../../features/team/useNotificationCount';
import { useOrg } from '../../features/team/useOrg';
import { useI18n } from '../../i18n/useI18n';
import type { AppRoute } from '../../lib/parseRoute';
import { useMailSummary } from '../../hooks/useMailSummary';
import { useRegulationsUnread } from '../../hooks/useRegulationsUnread';
import { SidebarLink } from './SidebarLink';

export interface SidebarNavProps {
  route: AppRoute;
  demo: boolean;
  isAdmin: boolean;
  onNavigate?: () => void;
}

export function SidebarNav({ route, demo, isAdmin, onNavigate }: SidebarNavProps) {
  const { t } = useI18n();
  const { org, can } = useOrg();
  const mail = useMailSummary(!demo && can('data.read'));
  const unread = useNotificationCount(!!org);
  const regulations = useRegulationsUnread(!demo && can('data.read'));
  // Until the organization is known, show only what every role has.
  const allowed = (href: string, permission?: string) => {
    const needed = permission ?? NAV_PERMISSIONS[href];
    return !needed || can(needed as Parameters<typeof can>[0]);
  };
  const groups = [...NAVIGATION.slice(0, -1), TEAM_NAVIGATION, ...NAVIGATION.slice(-1)];
  return (
    <nav className="sidebar-nav" aria-label={t('nav.app')}>
      {groups.filter((group) => isAdmin || !group.adminOnly).map((group) => {
        const items = group.items.filter((item) => !(demo && item.writes) && allowed(item.href, (item as { permission?: string }).permission));
        if (!items.length) return null;
        const headingId = `nav-${group.labelKey}`;
        return (
          <div key={group.labelKey} className="sidebar-group" role="group" aria-labelledby={headingId}>
            <p className="sidebar-group-label" id={headingId}>
              {t(group.labelKey)}
            </p>
            {items.map((item) => (
              <SidebarLink
                key={item.href}
                item={item}
                active={item.matches.includes(route.name)}
                onNavigate={onNavigate}
                count={item.badge === 'mail' ? mail?.unread : item.badge === 'regulations' ? regulations : item.href === '#/app/notifications' ? unread : undefined}
              />
            ))}
          </div>
        );
      })}
    </nav>
  );
}
