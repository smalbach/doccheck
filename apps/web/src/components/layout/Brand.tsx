export function Brand({ href = '#/' }: { href?: string }) {
  return (
    <a href={href} className="brand" aria-label="DocCheck">
      <span className="logo" aria-hidden>
        ✓
      </span>
      <span aria-hidden>DocCheck</span>
    </a>
  );
}
