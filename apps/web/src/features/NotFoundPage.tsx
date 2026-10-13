import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { useI18n } from '../i18n/useI18n';

export function NotFoundPage() {
  const { t } = useI18n();
  return (
    <Card>
      <h1 className="visually-hidden">{t('app.notFound')}</h1>
      <EmptyState
        title={t('app.notFound')}
        action={
          <Button asChild>
            <a href="#/app">{t('app.toDashboard')}</a>
          </Button>
        }
      />
    </Card>
  );
}
