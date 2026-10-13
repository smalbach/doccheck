import { HamburgerMenuIcon } from '@radix-ui/react-icons';
import { Dialog, VisuallyHidden } from 'radix-ui';
import { useState } from 'react';
import { Brand } from './Brand';
import { Sidebar, type SidebarProps } from './Sidebar';

/** On narrow screens the sidebar becomes a drawer opened from this bar. */
export function MobileTopbar(props: Omit<SidebarProps, 'onNavigate'>) {
  const [open, setOpen] = useState(false);
  return (
    <header className="mobile-topbar">
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Trigger className="btn btn-ghost icon-btn" aria-label="Open menu">
          <HamburgerMenuIcon />
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="sheet-overlay" />
          <Dialog.Content className="drawer" aria-describedby={undefined}>
            <VisuallyHidden.Root>
              <Dialog.Title>Menu</Dialog.Title>
            </VisuallyHidden.Root>
            <Sidebar {...props} onNavigate={() => setOpen(false)} />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Brand href="#/app" />
    </header>
  );
}
