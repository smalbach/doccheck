import { ChevronRightIcon } from '@radix-ui/react-icons';
import { Collapsible } from 'radix-ui';
import type { ReactNode } from 'react';

export interface DisclosureProps {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}

/** A summary line that expands to show more. */
export function Disclosure({ summary, children, defaultOpen = false }: DisclosureProps) {
  return (
    <Collapsible.Root className="disclosure" defaultOpen={defaultOpen}>
      <Collapsible.Trigger className="disclosure-trigger">
        <ChevronRightIcon className="disclosure-chevron" aria-hidden />
        {summary}
      </Collapsible.Trigger>
      <Collapsible.Content className="disclosure-content">{children}</Collapsible.Content>
    </Collapsible.Root>
  );
}
