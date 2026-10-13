/** Value at a dot path ("totals.grossWeight.kg", "contents.0.description"), or undefined. */
export function readPath(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (current === null || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[key];
  }, source);
}
