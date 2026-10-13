import type { ExtractionReport, Results } from '../api/types';

/**
 * The model the results page is about: the one the agent runs on (the app's configured model);
 * otherwise the one with the most documents evaluated. Other models are shown as comparisons.
 */
export function pickMainProvider(results: Results): string | undefined {
  const byAgent = results.extraction.find((r) => r.set === 'v1' && r.provider === results.agent?.provider);
  if (byAgent) return byAgent.provider;
  const ranked = [...results.extraction].sort((a: ExtractionReport, b: ExtractionReport) => b.documents - a.documents || b.overall.accuracy - a.overall.accuracy);
  return ranked[0]?.provider;
}
