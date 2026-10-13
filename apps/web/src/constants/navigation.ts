import { ArchiveIcon, BarChartIcon, DashboardIcon, LayersIcon, PlusIcon, ReaderIcon } from '@radix-ui/react-icons';
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
    labelKey: 'nav.reference',
    items: [
      { labelKey: 'nav.rules', href: '#/app/rules', icon: ReaderIcon, matches: ['rules'] },
      { labelKey: 'nav.evaluation', href: '#/app/results', icon: BarChartIcon, matches: ['results'] },
    ],
  },
];
