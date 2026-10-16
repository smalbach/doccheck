import type { DutyEstimate } from '../../api/dutyTypes';
import { useI18n } from '../../i18n/useI18n';

const CERT_KEY = { complete: 'duties.preference.complete', incomplete: 'duties.preference.incomplete', missing: 'duties.preference.missing', 'not-checked': 'duties.preference.notChecked' } as const;

/** The preference claimed and its proof, and the CUSMA rule-of-origin hints for lines from a CUSMA country. */
export function DutyPreference({ estimate }: { estimate: DutyEstimate }) {
  const { t } = useI18n();
  const { preference, cusma } = estimate;
  if (!preference && cusma.length === 0) return null;
  return (
    <section className="duty-section" aria-labelledby="duty-fta">
      <h3 id="duty-fta">{t('duties.preference.title')}</h3>
      {preference && (
        <p className="small">
          {t('duties.preference.claimed', { agreement: preference.agreement, lines: preference.lines.join(', ') || '—' })} · {t(CERT_KEY[preference.certification])}
        </p>
      )}
      {cusma.length > 0 && (
        <ul className="duty-list small">
          {cusma.map((c) => (
            <li key={c.lineNo}>
              {t('duties.preference.cusma', { line: c.lineNo, origin: c.origin })}: <span lang="en">{c.hint}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
