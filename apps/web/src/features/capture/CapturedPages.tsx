import { Cross2Icon } from '@radix-ui/react-icons';
import { Button } from '../../components/ui/Button';
import { useI18n } from '../../i18n/useI18n';
import type { ScanImage } from './frames';

export interface CapturedPagesProps {
  pages: readonly ScanImage[];
  disabled: boolean;
  onRemove: (index: number) => void;
}

/** Thumbnails of the pages kept so far, in PDF order. */
export function CapturedPages({ pages, disabled, onRemove }: CapturedPagesProps) {
  const { t } = useI18n();
  return (
    <section className="capture-pages" aria-labelledby="capture-pages-title">
      <h3 id="capture-pages-title" className="capture-subtitle">
        {t('capture.pages', { count: pages.length })}
      </h3>
      {pages.length === 0 ? (
        <p className="muted">{t('capture.noPages')}</p>
      ) : (
        <ol className="capture-thumbs">
          {pages.map((page, i) => (
            <li key={page.id} className="capture-thumb">
              <img src={page.url} alt={t('capture.pageAlt', { number: i + 1 })} />
              <Button variant="ghost" size="sm" className="capture-remove" aria-label={t('capture.removePage', { number: i + 1 })} disabled={disabled} onClick={() => onRemove(i)}>
                <Cross2Icon aria-hidden />
              </Button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
