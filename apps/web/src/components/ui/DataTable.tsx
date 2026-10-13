import type { ReactNode } from 'react';
import { useHorizontalOverflow } from '../../hooks/useHorizontalOverflow';
import { cx } from '../../lib/cx';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  numeric?: boolean;
  /** Hidden on narrow screens. */
  secondary?: boolean;
}

export interface DataTableProps<T> {
  columns: readonly Column<T>[];
  rows: readonly T[];
  rowKey: (row: T, index: number) => string;
  compact?: boolean;
  /** Makes rows clickable and reachable with the keyboard. */
  onRowClick?: (row: T) => void;
  /** Names the table (visually hidden) and its scroll region. */
  caption: string;
}

/**
 * A table that scrolls on its own instead of widening the page. When it does scroll, the scroll area
 * becomes a named, focusable region so keyboard users can scroll it too.
 */
export function DataTable<T>({ columns, rows, rowKey, compact, onRowClick, caption }: DataTableProps<T>) {
  const { ref, overflows } = useHorizontalOverflow<HTMLDivElement>();
  const colClass = (c: Column<T>) => cx(c.numeric && 'num', c.secondary && 'secondary');
  return (
    <div className="table-wrap" ref={ref} {...(overflows && { tabIndex: 0, role: 'region', 'aria-label': caption })}>
      <table className={cx('table', compact && 'table-compact', onRowClick && 'table-clickable')}>
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={colClass(c)} scope="col">
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={rowKey(row, i)}
              {...(onRowClick && {
                tabIndex: 0,
                onClick: () => onRowClick(row),
                onKeyDown: (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onRowClick(row);
                  }
                },
              })}
            >
              {columns.map((c) => (
                <td key={c.key} className={colClass(c)}>
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
