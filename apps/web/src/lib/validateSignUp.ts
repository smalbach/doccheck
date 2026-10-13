import type { MessageKey } from '../i18n/keys';

export interface SignUpInput {
  name: string;
  password: string;
  confirm: string;
}

export const MIN_PASSWORD_LENGTH = 8;

/** The first problem with a sign-up or new-password form, as a message key, or undefined. The API checks again. */
export function validateSignUp({ name, password, confirm }: SignUpInput): MessageKey | undefined {
  if (!name.trim()) return 'auth.errors.nameRequired';
  if (password.length < MIN_PASSWORD_LENGTH) return 'auth.errors.passwordTooShort';
  if (password !== confirm) return 'auth.errors.passwordMismatch';
  return undefined;
}
