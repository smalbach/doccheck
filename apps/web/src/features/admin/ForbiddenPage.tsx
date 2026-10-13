import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { useI18n } from '../../i18n/useI18n';

export function ForbiddenPage() {
  const { t } = useI18n();
  return (
    <Card>
      <h1 className="visually-hidden">{t('admin.forbiddenTitle')}</h1>
      <EmptyState title={t('admin.forbiddenTitle')}>{t('admin.forbiddenText')}</EmptyState>
    </Card>
  );
}
