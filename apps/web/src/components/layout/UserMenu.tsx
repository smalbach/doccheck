import { ExitIcon, PersonIcon } from '@radix-ui/react-icons';
import { DropdownMenu } from 'radix-ui';
import type { User } from '../../api/types';
import { navigate } from '../../lib/navigate';
import { Avatar } from '../ui/Avatar';

export interface UserMenuProps {
  user: User;
  onSignOut: () => void;
}

/** The signed-in user at the bottom of the sidebar, with Account and Sign out. */
export function UserMenu({ user, onSignOut }: UserMenuProps) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="user-menu-trigger">
        <Avatar name={user.name} email={user.email} />
        <span className="user-menu-text">
          <span className="user-menu-name">{user.name}</span>
          <span className="user-menu-email">{user.email}</span>
        </span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu" side="top" align="start" sideOffset={6}>
          <DropdownMenu.Item className="menu-item" onSelect={() => navigate('/app/account')}>
            <PersonIcon aria-hidden /> Account
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="menu-separator" />
          <DropdownMenu.Item className="menu-item" onSelect={onSignOut}>
            <ExitIcon aria-hidden /> Sign out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
