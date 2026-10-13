import { Card } from '../ui/Card';

export function LoadingCard({ error }: { error?: string }) {
  return <Card>{error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>}</Card>;
}
