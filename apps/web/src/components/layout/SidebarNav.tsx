import { NAVIGATION } from '../../constants/navigation';
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
  const mail = useMailSummary(!demo);
  const regulations = useRegulationsUnread(!demo);
  return (
    <nav className="sidebar-nav" aria-label={t('nav.app')}>
      {NAVIGATION.filter((group) => isAdmin || !group.adminOnly).map((group) => {
        const headingId = `nav-${group.labelKey}`;
        return (
          <div key={group.labelKey} className="sidebar-group" role="group" aria-labelledby={headingId}>
            <p className="sidebar-group-label" id={headingId}>
              {t(group.labelKey)}
            </p>
            {group.items
              .filter((item) => !(demo && item.writes))
              .map((item) => (
                <SidebarLink key={item.href} item={item} active={item.matches.includes(route.name)} onNavigate={onNavigate} count={item.badge === 'mail' ? mail?.unread : item.badge === 'regulations' ? regulations : undefined} />
              ))}
          </div>
        );
      })}
    </nav>
  );
}
