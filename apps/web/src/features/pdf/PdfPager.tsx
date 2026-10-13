import { ChevronLeftIcon, ChevronRightIcon } from '@radix-ui/react-icons';
import { Button } from '../../components/ui/Button';
import { useI18n } from '../../i18n/useI18n';

export interface PdfPagerProps {
  page: number;
  pages: number;
  onPageChange: (page: number) => void;
}

export function PdfPager({ page, pages, onPageChange }: PdfPagerProps) {
  const { t } = useI18n();
  if (pages <= 1) return null;
  return (
    <span className="pager">
      <Button variant="ghost" size="sm" onClick={() => onPageChange(page - 1)} disabled={page <= 1} aria-label={t('viewer.previous')}>
        <ChevronLeftIcon />
      </Button>
      <span aria-live="polite">{t('viewer.page', { page, pages })}</span>
      <Button variant="ghost" size="sm" onClick={() => onPageChange(page + 1)} disabled={page >= pages} aria-label={t('viewer.next')}>
        <ChevronRightIcon />
      </Button>
    </span>
  );
}
