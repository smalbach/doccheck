/** The signed-in user as the API returns it (never the password hash). */
export type Role = 'user' | 'admin';

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  createdAt: string;
}

export interface UserRow extends PublicUser {
  passwordHash: string;
}

/** Request augmented by AuthGuard. */
export interface AuthedRequest {
  user?: PublicUser;
  sessionTokenHash?: string;
  /** The session's id (GET /auth/sessions) and the organization it works in. */
  sessionId?: string;
  sessionOrgId?: string | null;
}

/** Where a session was opened from, shown in the session list. */
export interface SessionOrigin {
  ip?: string;
  userAgent?: string;
  method?: 'password' | 'sso' | 'reset';
  orgId?: string;
}

/** A live session of the user (never its token). */
export interface SessionInfo {
  id: string;
  current: boolean;
  method: string;
  ip?: string;
  userAgent?: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
}
