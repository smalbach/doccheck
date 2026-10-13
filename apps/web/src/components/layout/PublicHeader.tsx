import { useAuth } from '../../features/auth/useAuth';
import { Button } from '../ui/Button';
import { Brand } from './Brand';

/** Top bar of the landing and sign-in pages. */
export function PublicHeader() {
  const { user } = useAuth();
  return (
    <header className="public-header">
      <Brand />
      <nav className="public-nav" aria-label="Main">
        {user ? (
          <Button asChild variant="primary">
            <a href="#/app">Open the app</a>
          </Button>
        ) : (
          <>
            <Button asChild variant="ghost">
              <a href="#/login">Sign in</a>
            </Button>
            <Button asChild variant="primary">
              <a href="#/register">Get started</a>
            </Button>
          </>
        )}
      </nav>
    </header>
  );
}
