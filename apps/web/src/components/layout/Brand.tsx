import { LogoMark } from './LogoMark';

export function Brand({ href = '#/' }: { href?: string }) {
  return (
    <a href={href} className="brand" aria-label="DocCheck">
      <LogoMark />
      <span aria-hidden>DocCheck</span>
    </a>
  );
}
