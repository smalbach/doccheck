import type { TariffCodeStatus, TariffLine } from '../../api/types';
import { Tag } from '../../components/ui/Tag';
import { useI18n } from '../../i18n/useI18n';
import { formatHsCode } from '../../lib/formatHsCode';
import { AgencyTags } from './AgencyTags';
import { TariffNotes } from './TariffNotes';
import { TariffSuggestions } from './TariffSuggestions';

const TONE: Record<TariffCodeStatus, 'ok' | 'accent' | 'neutral'> = {
  valid: 'ok',
  subheading: 'ok',
  heading: 'accent',
  'national-unknown': 'accent',
  unknown: 'accent',
  malformed: 'accent',
  missing: 'neutral',
  'not-checked': 'neutral',
};

/** One invoice line: its declared code and whether it exists, the agent's view, suggestions and agency flags. */
export function TariffLineItem({ line }: { line: TariffLine }) {
  const { t } = useI18n();
  const fit = line.fit;
  return (
    <li className="tariff-line">
      <div className="tariff-line-head">
        <strong>{t('tariff.line', { lineNo: line.lineNo })}</strong> <span lang="en">{line.description}</span>
      </div>
      <div className="tariff-line-code">
        {line.declared ? (
          <>
            <span className="muted small">{t('tariff.declared')}</span> <code>{formatHsCode(line.declared)}</code>
          </>
        ) : (
          <span className="muted small">{t('tariff.noCode')}</span>
        )}{' '}
        {line.status !== 'missing' && <Tag tone={TONE[line.status]}>{t(`tariff.status.${line.status}`)}</Tag>}
        {line.title && (
          <div className="muted small" lang="en">
            {line.title}
          </div>
        )}
      </div>
      {fit && (
        <div className="tariff-fit">
          <span className={`verdict verdict-${fit.verdict}`}>{fit.by === 'search' ? t('tariff.fit.search') : t(`tariff.fit.${fit.verdict}`, { confidence: Math.round(fit.confidence * 100) })}</span>
          {fit.by === 'agent' && (
            <div className="muted small" lang="en">
              {fit.rationale}
            </div>
          )}
          <TariffNotes notes={fit.notes} />
        </div>
      )}
      <TariffSuggestions line={line} />
      {line.suggestionNotes && <TariffNotes notes={line.suggestionNotes} />}
      {(line.agencies.length > 0 || line.exportControl.length > 0) && (
        <div className="tariff-flags">
          <span className="muted small">{t('tariff.agencies')}</span> <AgencyTags agencies={line.agencies} />
          {line.exportControl.map((e) => (
            <Tag key={e.id} tone="accent">
              <span title={e.label}>{t('tariff.exportControl', { category: e.category })}</span>
            </Tag>
          ))}
        </div>
      )}
    </li>
  );
}
