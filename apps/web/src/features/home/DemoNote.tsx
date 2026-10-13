import { Card } from '../../components/ui/Card';

export function DemoNote() {
  return (
    <Card title="Read-only demo" className="demo-note">
      <p className="muted">
        Pick one of the synthetic shipments below: its three PDFs are extracted, then <strong>Validate</strong> runs the rules and the agent and shows each finding with the line it
        comes from and the regulation behind it. Uploads are turned off here; the model&apos;s answers were computed locally and are replayed from a cache.
      </p>
    </Card>
  );
}
