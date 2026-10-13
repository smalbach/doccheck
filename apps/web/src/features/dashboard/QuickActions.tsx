import { ArrowRightIcon, LayersIcon, PlusIcon, ReaderIcon } from '@radix-ui/react-icons';
import type { ComponentType } from 'react';
import { useI18n } from '../../i18n/useI18n';

interface Action {
  id: 'newShipment' | 'samples' | 'rules';
  href: string;
  icon: ComponentType<{ 'aria-hidden'?: boolean }>;
  writes?: boolean;
}

const ACTIONS: readonly Action[] = [
  { id: 'newShipment', href: '#/app/shipments/new', icon: PlusIcon, writes: true },
  { id: 'samples', href: '#/app/samples', icon: LayersIcon },
  { id: 'rules', href: '#/app/rules', icon: ReaderIcon },
];

export function QuickActions({ demo }: { demo: boolean }) {
  const { t } = useI18n();
  return (
    <div className="quick-actions">
      {ACTIONS.filter((a) => !(demo && a.writes)).map(({ id, href, icon: Icon }) => (
        <a key={id} href={href} className="quick-action">
          <Icon aria-hidden />
          <span className="quick-action-text">
            <strong>{t(`dashboard.actions.${id}.title`)}</strong>
            <span className="muted small">{t(`dashboard.actions.${id}.text`)}</span>
          </span>
          <ArrowRightIcon aria-hidden className="quick-action-arrow" />
        </a>
      ))}
    </div>
  );
}
