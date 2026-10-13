import { useI18n } from '../../i18n/useI18n';

export function AppFooter() {
  const { t } = useI18n();
  return <footer className="app-footer">{t('app.footer')}</footer>;
}
