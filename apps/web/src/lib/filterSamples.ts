import type { Sample } from '../api/types';
import type { SampleFilter } from '../constants/sampleErrors';

/** Samples matching the filter and, if given, the ID query (case-insensitive). */
export function filterSamples(samples: readonly Sample[], filter: SampleFilter, query: string): Sample[] {
  const q = query.trim().toLowerCase();
  return samples.filter((s) => {
    const matchesFilter = filter === 'all' ? true : filter === 'clean' ? s.errors.length === 0 : s.destination === filter;
    return matchesFilter && (!q || s.id.toLowerCase().includes(q));
  });
}
