import { useI18n } from '../../i18n/useI18n';
import { LOCALES } from '../../i18n/locales';
import { Select } from '../ui/Select';

export function LanguageSelect({ id }: { id?: string }) {
  const { locale, setLocale, t } = useI18n();
  return <Select id={id} value={locale} options={LOCALES} onValueChange={setLocale} ariaLabel={id ? undefined : t('prefs.language')} />;
}
