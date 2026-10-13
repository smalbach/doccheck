import { Card } from '../../components/ui/Card';
import { useI18n } from '../../i18n/useI18n';

export function DemoNote() {
  const { t } = useI18n();
  return (
    <Card title={t('dashboard.demoTitle')} className="demo-note">
      <p className="muted">
        {t('dashboard.demoBefore')} <a href="#/app/samples">{t('dashboard.demoLink')}</a>
        {t('dashboard.demoAfter')}
      </p>
    </Card>
  );
}
