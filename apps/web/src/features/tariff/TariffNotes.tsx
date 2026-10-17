import type { TariffNoteQuote } from '../../api/types';
import { Disclosure } from '../../components/ui/Disclosure';
import { useI18n } from '../../i18n/useI18n';

/** The tariff notes an answer relied on, each quoted with a link to its chapter. */
export function TariffNotes({ notes }: { notes: readonly TariffNoteQuote[] }) {
  const { t } = useI18n();
  if (notes.length === 0) return null;
  return (
    <Disclosure summary={t('tariff.notes')}>
      <ul className="tariff-notes">
        {notes.map((n) => (
          <li key={n.ref} lang="en">
            <a href={n.url} target="_blank" rel="noreferrer">
              {n.ref}
            </a>
            <blockquote className="muted small">{n.excerpt}</blockquote>
          </li>
        ))}
      </ul>
    </Disclosure>
  );
}
