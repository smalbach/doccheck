import { ApiError, type ApiIssue } from './ApiError';

interface ErrorBody {
  message?: string | string[];
  issues?: ApiIssue[];
}

/** Fired when the session is gone (expired, signed out elsewhere); the auth provider listens. */
export const UNAUTHORIZED_EVENT = 'doccheck:unauthorized';

// A 401 from these is an answer about the credentials, not a lost session.
const AUTH_ANSWERS = ['/auth/login', '/auth/me', '/auth/password'];

function messageOf(body: ErrorBody, res: Response): string {
  if (body.issues?.length) return body.issues.map((i) => i.message).join('. ');
  if (Array.isArray(body.message)) return body.message.join(', ');
  return body.message || `${res.status} ${res.statusText}`;
}

/** fetch + JSON with the API's error messages; 204 resolves to undefined. */
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin', ...init });
  if (!res.ok) {
    if (res.status === 401 && !AUTH_ANSWERS.some((p) => path.startsWith(p))) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    const body = (await res.json().catch(() => ({}))) as ErrorBody;
    throw new ApiError(res.status, messageOf(body, res), body.issues ?? []);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
