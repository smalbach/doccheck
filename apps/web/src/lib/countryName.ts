/** "CN" → "China" (or "Chine") in the given language; the code itself if the browser does not know it. */
export function countryName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}
