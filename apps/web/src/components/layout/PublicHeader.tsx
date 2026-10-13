import { useAuth } from '../../features/auth/useAuth';
import { useI18n } from '../../i18n/useI18n';
import { Button } from '../ui/Button';
import { Brand } from './Brand';
import { LanguageSelect } from './LanguageSelect';
import { ThemeToggle } from './ThemeToggle';

/** Top bar of the landing and sign-in pages. */
export function PublicHeader() {
  const { user } = useAuth();
  const { t } = useI18n();
  return (
    <header className="public-header">
      <Brand />
      <div className="public-header-tools">
        <LanguageSelect />
        <ThemeToggle />
      </div>
      <nav className="public-nav" aria-label={t('nav.main')}>
        {user ? (
          <Button asChild variant="primary">
            <a href="#/app">{t('auth.openApp')}</a>
          </Button>
        ) : (
          <>
            <Button asChild variant="ghost">
              <a href="#/login">{t('auth.signIn')}</a>
            </Button>
            <Button asChild variant="primary">
              <a href="#/register">{t('auth.getStarted')}</a>
            </Button>
          </>
        )}
      </nav>
    </header>
  );
}
