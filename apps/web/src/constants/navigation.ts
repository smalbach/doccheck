import { ActivityLogIcon, ArchiveIcon, BarChartIcon, ContainerIcon, CubeIcon, DashboardIcon, GearIcon, IdCardIcon, LayersIcon, ListBulletIcon, PersonIcon, PieChartIcon, PlusIcon, ReaderIcon, TableIcon } from '@radix-ui/react-icons';
import type { ComponentType } from 'react';
import type { MessageKey } from '../i18n/keys';
import type { AppRoute } from '../lib/parseRoute';

export interface NavItem {
  labelKey: MessageKey;
  href: string;
  icon: ComponentType<{ 'aria-hidden'?: boolean }>;
  /** Routes that light this item up. */
  matches: AppRoute['name'][];
  /** Hidden in the read-only demo. */
  writes?: boolean;
}

export interface NavGroup {
  labelKey: MessageKey;
  items: NavItem[];
  /** Shown to admins only (the server checks the role on every admin request anyway). */
  adminOnly?: boolean;
}

export const NAVIGATION: NavGroup[] = [
  {
    labelKey: 'nav.workspace',
    items: [
      { labelKey: 'nav.dashboard', href: '#/app', icon: DashboardIcon, matches: ['dashboard'] },
      { labelKey: 'nav.shipments', href: '#/app/shipments', icon: ArchiveIcon, matches: ['shipments', 'shipment'] },
      { labelKey: 'nav.newShipment', href: '#/app/shipments/new', icon: PlusIcon, matches: ['new-shipment'], writes: true },
      { labelKey: 'nav.samples', href: '#/app/samples', icon: LayersIcon, matches: ['samples'] },
    ],
  },
  {
    labelKey: 'nav.dataGroup',
    items: [
      { labelKey: 'nav.summary', href: '#/app/data', icon: PieChartIcon, matches: ['data-summary'] },
      { labelKey: 'nav.goods', href: '#/app/goods', icon: ListBulletIcon, matches: ['goods'] },
      { labelKey: 'nav.companies', href: '#/app/companies', icon: IdCardIcon, matches: ['companies', 'company'] },
      { labelKey: 'nav.products', href: '#/app/products', icon: CubeIcon, matches: ['products', 'product'] },
      { labelKey: 'nav.containers', href: '#/app/containers', icon: ContainerIcon, matches: ['containers'] },
      { labelKey: 'nav.figures', href: '#/app/data/shipments', icon: TableIcon, matches: ['data-shipments'] },
    ],
  },
  {
    labelKey: 'nav.reference',
    items: [
      { labelKey: 'nav.rules', href: '#/app/rules', icon: ReaderIcon, matches: ['rules'] },
      { labelKey: 'nav.evaluation', href: '#/app/results', icon: BarChartIcon, matches: ['results'] },
    ],
  },
  {
    labelKey: 'admin.section',
    adminOnly: true,
    items: [
      { labelKey: 'admin.settings', href: '#/app/admin/settings', icon: GearIcon, matches: ['admin-settings'] },
      { labelKey: 'admin.users', href: '#/app/admin/users', icon: PersonIcon, matches: ['admin-users'] },
      { labelKey: 'admin.system', href: '#/app/admin/system', icon: ActivityLogIcon, matches: ['admin-system'] },
    ],
  },
];
