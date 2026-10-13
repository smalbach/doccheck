export interface SignUpInput {
  name: string;
  email: string;
  password: string;
  confirm: string;
}

export const MIN_PASSWORD_LENGTH = 8;

/** The first problem with a sign-up or new-password form, or undefined. The API checks again. */
export function validateSignUp({ name, password, confirm }: SignUpInput): string | undefined {
  if (!name.trim()) return 'Enter your name.';
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters for the password.`;
  if (password !== confirm) return 'The passwords do not match.';
  return undefined;
}
