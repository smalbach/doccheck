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
}
