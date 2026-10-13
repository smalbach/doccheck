import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const reportsDir = () =>
  [process.env.REPORTS_DIR, resolve(process.cwd(), 'eval/reports'), resolve(__dirname, '../../../../eval/reports')].find((d): d is string => !!d && existsSync(d));

/** Field accuracy measured for a model on the main evaluation set (eval/reports), or null if never measured. */
export async function modelAccuracy(model: string): Promise<{ accuracy: number; documents: number } | null> {
  const dir = reportsDir();
  if (!dir) return null;
  const base = model.replace(/:latest$/, '');
  const file = join(dir, `extraction-${`ollama:${base}`.replace(/[^\w.-]+/g, '_')}.json`);
  if (!existsSync(file)) return null;
  try {
    const report = JSON.parse(await readFile(file, 'utf8')) as { overall?: { accuracy?: number }; documents?: number };
    return typeof report.overall?.accuracy === 'number' ? { accuracy: report.overall.accuracy, documents: report.documents ?? 0 } : null;
  } catch {
    return null;
  }
}
