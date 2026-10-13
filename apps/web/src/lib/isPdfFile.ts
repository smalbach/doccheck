/** Browsers do not always set the type of a dropped file, so the extension counts too. */
export function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}
