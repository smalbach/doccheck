/** Whether the value at `pointer`, or any value inside it, was corrected by hand. */
export function isCorrected(corrected: ReadonlyMap<string, unknown>, pointer: string): boolean {
  for (const path of corrected.keys()) if (path === pointer || path.startsWith(`${pointer}/`)) return true;
  return false;
}
