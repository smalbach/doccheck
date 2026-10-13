import type { NavItem } from '../../constants/navigation';
import { useI18n } from '../../i18n/useI18n';
import { cx } from '../../lib/cx';

export interface SidebarLinkProps {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
}

export function SidebarLink({ item, active, onNavigate }: SidebarLinkProps) {
  const { t } = useI18n();
  const Icon = item.icon;
  return (
    <a href={item.href} className={cx('sidebar-link', active && 'active')} aria-current={active ? 'page' : undefined} onClick={onNavigate}>
      <Icon aria-hidden />
      <span>{t(item.labelKey)}</span>
    </a>
  );
}
