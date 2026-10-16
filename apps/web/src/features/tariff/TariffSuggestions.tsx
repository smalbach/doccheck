import type { TariffLine } from '../../api/types';
import { useI18n } from '../../i18n/useI18n';
import { formatHsCode } from '../../lib/formatHsCode';
import { AgencyTags } from './AgencyTags';

/** Candidate subheadings: the model's picks for a line without a code, or what the search found when the declared one is doubted. */
export function TariffSuggestions({ line }: { line: TariffLine }) {
  const { t } = useI18n();
  const suggestions = line.suggestions ?? [];
  if (suggestions.length === 0) return null;
  const byModel = suggestions.some((s) => s.confidence !== undefined);
  return (
    <div className="tariff-suggestions">
      <h3 className="small">{t(byModel ? 'tariff.suggestions' : 'tariff.suggestionsSearch')}</h3>
      <ol>
        {suggestions.map((s) => (
          <li key={s.code}>
            <code>{formatHsCode(s.code)}</code> <span lang="en">{s.title}</span>
            {s.confidence !== undefined && <span className="muted small"> · {Math.round(s.confidence * 100)}%</span>}
            {s.rationale && (
              <div className="muted small" lang="en">
                {s.rationale}
              </div>
            )}
            <AgencyTags agencies={s.agencies} />
          </li>
        ))}
      </ol>
    </div>
  );
}
