import type { MessageKey } from '../i18n/keys';
import { MIN_PASSWORD_LENGTH } from './validateSignUp';

/** The first problem with a new password and its confirmation, as a message key, or undefined. The API checks again. */
export function validateNewPassword(password: string, confirm: string): MessageKey | undefined {
  if (password.length < MIN_PASSWORD_LENGTH) return 'auth.errors.passwordTooShort';
  if (password !== confirm) return 'auth.errors.passwordMismatch';
  return undefined;
}
