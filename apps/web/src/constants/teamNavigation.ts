import { BellIcon, CheckCircledIcon, FileTextIcon, PersonIcon } from '@radix-ui/react-icons';
import type { OrgPermission } from '../api/teamTypes';
import type { NavGroup } from './navigation';

/** Pages of the team section, each shown to roles with its permission. */
export const TEAM_NAVIGATION: NavGroup & { items: (NavGroup['items'][number] & { permission?: OrgPermission; badge?: 'mail' | 'notifications' })[] } = {
  labelKey: 'team.nav.group',
  items: [
    { labelKey: 'team.nav.notifications', href: '#/app/notifications', icon: BellIcon, matches: ['notifications'] },
    { labelKey: 'team.nav.approvals', href: '#/app/approvals', icon: CheckCircledIcon, matches: ['approvals'], permission: 'finding.approve' },
    { labelKey: 'team.nav.members', href: '#/app/team', icon: PersonIcon, matches: ['team'], permission: 'data.read' },
    { labelKey: 'team.nav.audit', href: '#/app/audit', icon: FileTextIcon, matches: ['audit'], permission: 'audit.read' },
  ],
};

/**
 * What a role needs to see each page already in the sidebar; pages not listed are for every role.
 * A client sees the shipments shared with them and nothing else of the organization.
 */
export const NAV_PERMISSIONS: Record<string, OrgPermission> = {
  '#/app': 'data.read',
  '#/app/inbox': 'data.read',
  '#/app/shipments/new': 'shipment.write',
  '#/app/samples': 'shipment.write',
  '#/app/data': 'data.read',
  '#/app/goods': 'data.read',
  '#/app/companies': 'data.read',
  '#/app/products': 'data.read',
  '#/app/containers': 'data.read',
  '#/app/data/shipments': 'data.read',
  '#/app/integrations': 'integrations.manage',
  '#/app/api-docs': 'data.read',
};
