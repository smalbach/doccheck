import { ChevronLeftIcon, ChevronRightIcon } from '@radix-ui/react-icons';
import { useI18n } from '../../i18n/useI18n';
import { Button } from './Button';

export interface PagerProps {
  offset: number;
  limit: number;
  total: number;
  onOffsetChange: (offset: number) => void;
  /** What is being paged, for the screen-reader name of the controls, e.g. "Shipments pages". */
  label: string;
  busy?: boolean;
}

/** "26–50 of 80" with previous and next; hidden when everything fits on one page. */
export function Pager({ offset, limit, total, onOffsetChange, label, busy }: PagerProps) {
  const { t } = useI18n();
  if (total <= limit && offset === 0) return null;
  const from = total === 0 ? 0 : Math.min(offset + 1, total);
  const to = Math.min(offset + limit, total);
  return (
    <nav className="pager" aria-label={label} aria-busy={busy}>
      <span className="muted small">{t('pager.range', { from, to, total })}</span>
      <Button size="sm" disabled={offset === 0} onClick={() => onOffsetChange(Math.max(0, offset - limit))}>
        <ChevronLeftIcon aria-hidden /> {t('pager.previous')}
      </Button>
      <Button size="sm" disabled={offset + limit >= total} onClick={() => onOffsetChange(offset + limit)}>
        {t('pager.next')} <ChevronRightIcon aria-hidden />
      </Button>
    </nav>
  );
}
