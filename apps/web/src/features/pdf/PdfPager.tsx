import { ChevronLeftIcon, ChevronRightIcon } from '@radix-ui/react-icons';
import { Button } from '../../components/ui/Button';

export interface PdfPagerProps {
  page: number;
  pages: number;
  onPageChange: (page: number) => void;
}

export function PdfPager({ page, pages, onPageChange }: PdfPagerProps) {
  if (pages <= 1) return null;
  return (
    <span className="pager">
      <Button variant="ghost" size="sm" onClick={() => onPageChange(page - 1)} disabled={page <= 1} aria-label="Previous page">
        <ChevronLeftIcon />
      </Button>
      {page} / {pages}
      <Button variant="ghost" size="sm" onClick={() => onPageChange(page + 1)} disabled={page >= pages} aria-label="Next page">
        <ChevronRightIcon />
      </Button>
    </span>
  );
}
