import { useEffect } from 'react';
import { LoginPage } from '../../features/auth/LoginPage';
import { RegisterPage } from '../../features/auth/RegisterPage';
import { useAuth } from '../../features/auth/useAuth';
import { LandingPage } from '../../features/landing/LandingPage';
import { navigate } from '../../lib/navigate';
import type { PublicRoute } from '../../lib/parseRoute';
import { safeNext } from '../../lib/safeNext';

/** Landing, sign-in and sign-up. Signed-in visitors skip the forms. */
export function PublicRouteView({ route }: { route: PublicRoute }) {
  const { user } = useAuth();
  const isForm = route.name !== 'landing';
  const next = route.name === 'landing' ? undefined : route.next;

  useEffect(() => {
    if (isForm && user) navigate(safeNext(next));
  }, [isForm, user, next]);

  switch (route.name) {
    case 'landing':
      return <LandingPage />;
    case 'login':
      return <LoginPage next={route.next} />;
    case 'register':
      return <RegisterPage next={route.next} />;
  }
}
