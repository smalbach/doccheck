export function Brand({ href = '#/' }: { href?: string }) {
  return (
    <a href={href} className="brand">
      <span className="logo" aria-hidden>
        ✓
      </span>
      DocCheck
    </a>
  );
}
