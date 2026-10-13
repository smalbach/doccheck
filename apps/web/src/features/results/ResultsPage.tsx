import { LoadingCard } from '../../components/layout/LoadingCard';
import { Card } from '../../components/ui/Card';
import { PageHeader } from '../../components/ui/PageHeader';
import { useI18n } from '../../i18n/useI18n';
import { pickMainProvider } from '../../lib/pickMainProvider';
import { ExtractionSetCard } from './ExtractionSetCard';
import { ModelComparison } from './ModelComparison';
import { RulesTable } from './RulesTable';
import { StatsGrid } from './StatsGrid';
import { useResults } from './useResults';

/** Evaluation results on the synthetic set, from eval/reports through GET /results. */
export function ResultsPage() {
  const { t } = useI18n();
  const { results, error } = useResults();
  if (!results) return <LoadingCard error={error && t('results.loadError', { message: error })} />;

  const main = pickMainProvider(results);
  const sets = results.extraction.filter((r) => r.provider === main);
  const v1 = sets.find((r) => r.set === 'v1');
  const others = results.extraction.filter((r) => r.provider !== main && r.set === 'v1');

  return (
    <div className="page results">
      <PageHeader
        title={t('results.title')}
        description={t('results.description', {
          model: v1 ? (v1.modelVersion ? t('results.modelBuild', { provider: v1.provider, build: v1.modelVersion }) : t('results.model', { provider: v1.provider })) : '',
        })}
      />

      {sets.length === 0 ? (
        <Card>
          <p className="muted">{t('results.noRun')}</p>
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
