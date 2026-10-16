/** Where to go after signing in: only paths inside the app (or an invitation link), never another site. */
export function safeNext(next: string | undefined): string {
  if (next && /^\/invite\?token=[\w-]+$/.test(next)) return next;
  return next && /^\/app(\/|$)/.test(next) && !next.includes('//') ? next : '/app';
}
