import type { NavItem } from '../../constants/navigation';
import { useI18n } from '../../i18n/useI18n';
import { cx } from '../../lib/cx';

export interface SidebarLinkProps {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
  /** A count next to the label (unread replies, regulation changes not seen). */
  count?: number;
}

export function SidebarLink({ item, active, onNavigate, count }: SidebarLinkProps) {
  const { t } = useI18n();
  const Icon = item.icon;
  return (
    <a href={item.href} className={cx('sidebar-link', active && 'active')} aria-current={active ? 'page' : undefined} onClick={onNavigate}>
      <Icon aria-hidden />
      <span>{t(item.labelKey)}</span>
      {!!count && (
        <span className="sidebar-badge" aria-label={item.badge === 'regulations' ? t('analytics.regulations.unread', { count }) : t('mail.unread', { count })}>
          {count}
        </span>
      )}
    </a>
  );
}
