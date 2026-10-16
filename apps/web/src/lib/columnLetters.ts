/** Spreadsheet column letters from a 0-based index: 0 -> "A", 27 -> "AB". */
export function columnLetters(col: number): string {
  let letters = '';
  for (let n = col + 1; n > 0; n = Math.floor((n - 1) / 26)) letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  return letters;
}
