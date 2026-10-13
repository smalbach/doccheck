/** "Ada Lovelace" → "AL"; falls back to the email's first letter. */
export function initials(name: string, email = ''): string {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  return letters || email.charAt(0).toUpperCase() || '?';
}
