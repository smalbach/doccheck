/** Where to go after signing in: only paths inside the app, never another site. */
export function safeNext(next: string | undefined): string {
  return next && /^\/app(\/|$)/.test(next) && !next.includes('//') ? next : '/app';
}
