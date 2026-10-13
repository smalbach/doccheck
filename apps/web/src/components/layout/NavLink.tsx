import type { ReactNode } from 'react';

export interface NavLinkProps {
  href: string;
  active: boolean;
  children: ReactNode;
}

export function NavLink({ href, active, children }: NavLinkProps) {
  return (
    <a href={href} className={active ? 'nav-link active' : 'nav-link'} aria-current={active ? 'page' : undefined}>
      {children}
    </a>
  );
}
