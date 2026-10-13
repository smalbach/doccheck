/**
 * Accounts that are admins, from ADMIN_EMAILS (comma-separated). This is the only way to get the
 * first admin: signing up never grants it. Admins can then promote others from the web.
 */
export function adminEmails(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}
