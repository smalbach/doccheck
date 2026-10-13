import { ExitIcon } from '@radix-ui/react-icons';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { navigate } from '../../lib/navigate';
import { useAuth } from '../auth/useAuth';

export function SessionCard() {
  const { logout } = useAuth();
  return (
    <Card title="Session">
      <p className="muted">You stay signed in on this device for 30 days. Changing the password signs out every other device.</p>
      <Button onClick={() => void logout().then(() => navigate('/'))}>
        <ExitIcon aria-hidden /> Sign out
      </Button>
    </Card>
  );
}
