import { ArchiveIcon, BarChartIcon, DashboardIcon, LayersIcon, PlusIcon, ReaderIcon } from '@radix-ui/react-icons';
import type { ComponentType } from 'react';
import type { AppRoute } from '../lib/parseRoute';

export interface NavItem {
  label: string;
  href: string;
  icon: ComponentType<{ 'aria-hidden'?: boolean }>;
  /** Routes that light this item up. */
  matches: AppRoute['name'][];
  /** Hidden in the read-only demo. */
  writes?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAVIGATION: NavGroup[] = [
  {
    label: 'Workspace',
    items: [
      { label: 'Dashboard', href: '#/app', icon: DashboardIcon, matches: ['dashboard'] },
      { label: 'Shipments', href: '#/app/shipments', icon: ArchiveIcon, matches: ['shipments', 'shipment'] },
      { label: 'New shipment', href: '#/app/shipments/new', icon: PlusIcon, matches: ['new-shipment'], writes: true },
      { label: 'Samples', href: '#/app/samples', icon: LayersIcon, matches: ['samples'] },
    ],
  },
  {
    label: 'Reference',
    items: [
      { label: 'Rules', href: '#/app/rules', icon: ReaderIcon, matches: ['rules'] },
      { label: 'Evaluation', href: '#/app/results', icon: BarChartIcon, matches: ['results'] },
    ],
  },
];
