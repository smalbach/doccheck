import { LanguageSelect } from '../../components/layout/LanguageSelect';
import { ThemeToggle } from '../../components/layout/ThemeToggle';
import { Card } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { useI18n } from '../../i18n/useI18n';
import { BackgroundNotifySetting } from '../notifications/BackgroundNotifySetting';

export function PreferencesCard() {
  const { t } = useI18n();
  return (
    <Card title={t('prefs.title')}>
      <p className="muted">{t('prefs.description')}</p>
      <div className="stack-form">
        <Field label={t('prefs.language')}>{(id) => <LanguageSelect id={id} />}</Field>
        <div className="field">
          <span className="field-label">{t('prefs.theme')}</span>
          <ThemeToggle showLabels />
        </div>
        <BackgroundNotifySetting />
      </div>
    </Card>
  );
}
