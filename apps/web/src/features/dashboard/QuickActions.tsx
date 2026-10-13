import { ArrowRightIcon, LayersIcon, PlusIcon, ReaderIcon } from '@radix-ui/react-icons';
import type { ComponentType } from 'react';

interface Action {
  href: string;
  title: string;
  text: string;
  icon: ComponentType<{ 'aria-hidden'?: boolean }>;
  writes?: boolean;
}

const ACTIONS: Action[] = [
  { href: '#/app/shipments/new', title: 'New shipment', text: 'Upload the PDFs of a real shipment and validate them.', icon: PlusIcon, writes: true },
  { href: '#/app/samples', title: 'Try a sample', text: 'Synthetic shipments with known errors, ready to check.', icon: LayersIcon },
  { href: '#/app/rules', title: 'What gets checked', text: 'Every rule, by destination, with what it needs.', icon: ReaderIcon },
];

export function QuickActions({ demo }: { demo: boolean }) {
  return (
    <div className="quick-actions">
      {ACTIONS.filter((a) => !(demo && a.writes)).map(({ href, title, text, icon: Icon }) => (
        <a key={href} href={href} className="quick-action">
          <Icon aria-hidden />
          <span className="quick-action-text">
            <strong>{title}</strong>
            <span className="muted small">{text}</span>
          </span>
          <ArrowRightIcon aria-hidden className="quick-action-arrow" />
        </a>
      ))}
    </div>
  );
}
