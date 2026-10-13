import { useI18n } from '../../i18n/useI18n';

/** First focusable element: jumps past the navigation to the page. */
export function SkipLink() {
  const { t } = useI18n();
  return (
    <a className="skip-link" href="#main-content" onClick={(e) => { e.preventDefault(); document.getElementById('main-content')?.focus(); }}>
      {t('app.skipToContent')}
    </a>
  );
}
