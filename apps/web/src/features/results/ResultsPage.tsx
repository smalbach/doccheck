import { LoadingCard } from '../../components/layout/LoadingCard';
import { Card } from '../../components/ui/Card';
import { PageHeader } from '../../components/ui/PageHeader';
import { pickMainProvider } from '../../lib/pickMainProvider';
import { ExtractionSetCard } from './ExtractionSetCard';
import { ModelComparison } from './ModelComparison';
import { RulesTable } from './RulesTable';
import { StatsGrid } from './StatsGrid';
import { useResults } from './useResults';

/** Evaluation results on the synthetic set, from eval/reports through GET /results. */
export function ResultsPage() {
  const { results, error } = useResults();
  if (!results) return <LoadingCard error={error && `Could not load results (${error}).`} />;

  const main = pickMainProvider(results);
  const sets = results.extraction.filter((r) => r.provider === main);
  const v1 = sets.find((r) => r.set === 'v1');
  const others = results.extraction.filter((r) => r.provider !== main && r.set === 'v1');

  return (
    <div className="page results">
      <PageHeader
        title="Evaluation"
        description={
          <>
            Measured on synthetic shipments with known, injected errors (100 to Canada, 100 to the US), with the model running locally
            {v1 && ` (${v1.provider}${v1.modelVersion ? `, build ${v1.modelVersion}` : ''})`}. Real documents will differ: treat these as a lower bound on what can go wrong, not a
            guarantee.
          </>
        }
      />

      {sets.length === 0 ? (
        <Card>
          <p className="muted">No evaluation has been run yet (npm run eval:extraction).</p>
        </Card>
      ) : (
        <StatsGrid sets={sets} agent={results.agent?.summary ?? []} />
      )}
      {v1 && <RulesTable report={v1} />}
      <div className="results-sets">
        {sets.map((r) => (
          <ExtractionSetCard key={r.set} report={r} />
        ))}
      </div>
      {v1 && others.length > 0 && <ModelComparison reports={[v1, ...others]} />}
    </div>
  );
}
