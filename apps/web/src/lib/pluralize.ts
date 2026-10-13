/** pluralize(1, 'page') → "1 page"; pluralize(3, 'page') → "3 pages". */
export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
