import { useI18n } from '../../i18n/useI18n';
import { Card } from '../ui/Card';

/** What a page that crashed shows (a class error boundary cannot use hooks, so it renders this). */
export function PageError({ message }: { message: string }) {
  const { t } = useI18n();
  return (
    <Card>
      <p className="error" role="alert">
        {t('app.pageError', { message })}
      </p>
      <a href="#/app">{t('app.toDashboard')}</a>
    </Card>
  );
}
