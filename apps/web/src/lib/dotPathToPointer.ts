/** A dot path ("lines.0.quantity.value") as a JSON pointer ("/lines/0/quantity/value"). */
export function dotPathToPointer(path: string): string {
  return path
    .split('.')
    .map((s) => `/${s.replace(/~/g, '~0').replace(/\//g, '~1')}`)
    .join('');
}
