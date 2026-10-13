export function Spinner({ label = 'In progress' }: { label?: string }) {
  return <span className="spinner" role="status" aria-label={label} />;
}
