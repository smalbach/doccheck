import type { Total } from '../../api/types';
import { useI18n } from '../../i18n/useI18n';

export interface MoneyListProps {
  totals: readonly Total[];
  /** One amount per line instead of "US$1.00 · CA$2.00". */
  stacked?: boolean;
}

/** Amounts in several currencies, never added together. */
export function MoneyList({ totals, stacked }: MoneyListProps) {
  const { formatMoney } = useI18n();
  if (totals.length === 0) return <>—</>;
  const amounts = totals.map((v) => formatMoney(v.amount, v.key));
  return stacked ? (
    <>
      {amounts.map((a) => (
        <span key={a} className="nowrap block">
          {a}
        </span>
      ))}
    </>
  ) : (
    <>{amounts.join(' · ')}</>
  );
}
