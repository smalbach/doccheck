import { useEffect } from 'react';
import { ForgotPasswordPage } from '../../features/auth/ForgotPasswordPage';
import { LoginPage } from '../../features/auth/LoginPage';
import { RegisterPage } from '../../features/auth/RegisterPage';
import { ResetPasswordPage } from '../../features/auth/ResetPasswordPage';
import { useAuth } from '../../features/auth/useAuth';
import { LandingPage } from '../../features/landing/LandingPage';
import { navigate } from '../../lib/navigate';
import type { PublicRoute } from '../../lib/parseRoute';
import { safeNext } from '../../lib/safeNext';

/**
 * Landing, sign-in, sign-up and the forgotten-password pages. Signed-in visitors skip sign-in and
 * sign-up; a reset link still opens for them (it may be for another account).
 */
export function PublicRouteView({ route }: { route: PublicRoute }) {
  const { user } = useAuth();
  const isForm = route.name === 'login' || route.name === 'register';
  const next = isForm ? route.next : undefined;

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
    case 'forgot-password':
      return <ForgotPasswordPage />;
    case 'reset-password':
      return <ResetPasswordPage token={route.token} />;
  }
}
