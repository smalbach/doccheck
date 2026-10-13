import type { ReactNode } from 'react';
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
  caption?: string;
}

/** A table that scrolls on its own instead of widening the page. */
export function DataTable<T>({ columns, rows, rowKey, compact, onRowClick, caption }: DataTableProps<T>) {
  const colClass = (c: Column<T>) => cx(c.numeric && 'num', c.secondary && 'secondary');
  return (
    <div className="table-wrap">
      <table className={cx('table', compact && 'table-compact', onRowClick && 'table-clickable')}>
        {caption && <caption className="visually-hidden">{caption}</caption>}
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
