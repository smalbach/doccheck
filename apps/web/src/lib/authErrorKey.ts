import { ApiError } from '../api/ApiError';
import type { MessageKey } from '../i18n/keys';

/** Sign-in and sign-up answers the user can act on, by status; anything else shows the API's message. */
export function authErrorKey(error: unknown): MessageKey | undefined {
  if (!(error instanceof ApiError)) return undefined;
  switch (error.status) {
    case 401:
      return 'auth.errors.wrongCredentials';
    case 409:
      return 'auth.errors.emailTaken';
    case 429:
      return error.message.includes('accounts created') ? 'auth.errors.tooManySignups' : 'auth.errors.tooMany';
    default:
      return undefined;
  }
}
