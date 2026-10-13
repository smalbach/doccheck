import { Tabs as RadixTabs } from 'radix-ui';
import type { ReactNode } from 'react';

export interface TabItem<T extends string> {
  value: T;
  label: ReactNode;
  content: ReactNode;
}

export interface TabsProps<T extends string> {
  items: readonly TabItem<T>[];
  defaultValue: T;
  ariaLabel: string;
  /** Controlled: the open tab, and what to do when another is picked. */
  value?: T;
  onValueChange?: (value: T) => void;
}

export function Tabs<T extends string>({ items, defaultValue, ariaLabel, value, onValueChange }: TabsProps<T>) {
  return (
    <RadixTabs.Root className="tabs" defaultValue={defaultValue} value={value} onValueChange={onValueChange && ((v) => onValueChange(v as T))}>
      <RadixTabs.List className="tabs-list" aria-label={ariaLabel}>
        {items.map((t) => (
          <RadixTabs.Trigger key={t.value} value={t.value} className="tabs-trigger">
            {t.label}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      {items.map((t) => (
        <RadixTabs.Content key={t.value} value={t.value} className="tabs-content">
          {t.content}
        </RadixTabs.Content>
      ))}
    </RadixTabs.Root>
  );
}
