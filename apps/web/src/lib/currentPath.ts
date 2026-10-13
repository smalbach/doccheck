/** The hash path without "#" and query, e.g. "/app/s/<id>". */
export function currentPath(): string {
  return window.location.hash.replace(/^#/, '').split('?')[0] || '/';
}
