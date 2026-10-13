import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';

export function NotFoundPage() {
  return (
    <Card>
      <EmptyState
        title="This page does not exist"
        action={
          <Button asChild>
            <a href="#/app">Go to the dashboard</a>
          </Button>
        }
      />
    </Card>
  );
}
