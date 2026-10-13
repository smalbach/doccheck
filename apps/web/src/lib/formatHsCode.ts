/** "950300" → "9503.00"; other lengths as given. */
export function formatHsCode(code: string): string {
  const digits = code.replace(/\D/g, '');
  return digits.length >= 6 ? `${digits.slice(0, 4)}.${digits.slice(4, 6)}${digits.length > 6 ? `.${digits.slice(6)}` : ''}` : code;
}
