import { ExitIcon } from '@radix-ui/react-icons';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { useI18n } from '../../i18n/useI18n';
import { navigate } from '../../lib/navigate';
import { useAuth } from '../auth/useAuth';

export function SessionCard() {
  const { logout } = useAuth();
  const { t } = useI18n();
  return (
    <Card title={t('account.sessionTitle')}>
      <p className="muted">{t('account.sessionText')}</p>
      <Button onClick={() => void logout().then(() => navigate('/'))}>
        <ExitIcon aria-hidden /> {t('nav.signOut')}
      </Button>
    </Card>
  );
}
