import { useI18n } from '../../i18n/useI18n';
import { Card } from '../ui/Card';

export function LoadingCard({ error }: { error?: string }) {
  const { t } = useI18n();
  return (
    <Card aria-busy={!error}>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : (
        <p className="muted" role="status">
          {t('common.loading')}
        </p>
      )}
    </Card>
  );
}
