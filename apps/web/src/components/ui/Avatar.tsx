import { Avatar as RadixAvatar } from 'radix-ui';
import { initials } from '../../lib/initials';

export function Avatar({ name, email }: { name: string; email?: string }) {
  return (
    <RadixAvatar.Root className="avatar">
      <RadixAvatar.Fallback className="avatar-fallback">{initials(name, email)}</RadixAvatar.Fallback>
    </RadixAvatar.Root>
  );
}
