import type { Destination } from '@doccheck/schemas';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { TariffNotes, type NotesFile } from './notes';
import { TariffSchedule, type ScheduleFile } from './schedule';

export interface TariffData {
  schedule: TariffSchedule;
  notes: TariffNotes;
}

/** data/tariff, from TARIFF_DIR or found from the working directory or this package. */
export function findTariffDir(): string | undefined {
  return [process.env.TARIFF_DIR, resolve(process.cwd(), 'data/tariff'), resolve(__dirname, '../../../data/tariff')].find((d): d is string => !!d && existsSync(join(d, 'us', 'schedule.json')));
}

export async function loadTariffData(dir: string, destination: Destination): Promise<TariffData> {
  const sub = join(dir, destination.toLowerCase());
  const schedule = new TariffSchedule(JSON.parse(await readFile(join(sub, 'schedule.json'), 'utf8')) as ScheduleFile);
  const notes = new TariffNotes(JSON.parse(await readFile(join(sub, 'notes.json'), 'utf8')) as NotesFile);
  return { schedule, notes };
}

/** Subheading embeddings of a schedule: data/tariff/index/<us|ca>-<model>.json (+ .i8). */
export const vectorIndexFile = (dir: string, destination: Destination, model: string) => join(dir, 'index', `${destination.toLowerCase()}-${model}.json`);
