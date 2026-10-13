/**
 * The public base URL of the web app, for links in emails. Never taken from the request (a forged
 * Host header would send reset links to another site): APP_URL, or the Vite dev server outside
 * production. Undefined when it cannot be known.
 */
export function appUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const url = env.APP_URL?.trim();
  if (url) return url.replace(/\/+$/, '');
  return env.NODE_ENV === 'production' ? undefined : 'http://localhost:5173';
}
