import { ApiError } from '../api/ApiError';
import type { MessageKey } from '../i18n/keys';

/** Answers of the forgotten-password endpoints the user can act on; anything else shows the API's message. */
export function resetErrorKey(error: unknown): MessageKey | undefined {
  if (!(error instanceof ApiError)) return undefined;
  if (error.status === 429) return 'auth.errors.tooManyResets';
  if (error.status === 400 && error.message.includes('reset link')) return 'auth.errors.resetLinkInvalid';
  return undefined;
}
