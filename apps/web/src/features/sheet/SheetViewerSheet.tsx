import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client';
import { Sheet } from '../../components/ui/Sheet';
import { ToggleChips } from '../../components/ui/ToggleChips';
import { DOCUMENT_TYPE_KEY } from '../../constants/documentTypes';
import { useQuery } from '../../hooks/useQuery';
import { useI18n } from '../../i18n/useI18n';
import { columnLetters } from '../../lib/columnLetters';
import type { ViewerTarget } from '../pdf/types';

export interface SheetViewerSheetProps {
  shipmentId: string;
  target: ViewerTarget;
  onClose: () => void;
}

/** A spreadsheet document's cells, one sheet at a time, with the cell a finding cites outlined and scrolled into view. */
export function SheetViewerSheet({ shipmentId, target, onClose }: SheetViewerSheetProps) {
  const { t } = useI18n();
  const { doc, highlight } = target;
  const { data, error } = useQuery(`${shipmentId}/${doc.id}`, () => api.sheets(shipmentId, doc.id));
  const [page, setPage] = useState(highlight?.page ?? doc.pages?.[0] ?? 1);
  const cited = useRef<HTMLTableCellElement>(null);

  useEffect(() => setPage(highlight?.page ?? doc.pages?.[0] ?? 1), [highlight, doc.pages]);
  useEffect(() => cited.current?.scrollIntoView({ block: 'center', inline: 'center' }), [data, page]);

  const pages = data?.pages ?? [];
  const sheet = data?.sheets[page - 1];
  const width = Math.max(1, ...(sheet?.rows.map((r) => r.length) ?? [1]));
  const cell = highlight?.page === page ? highlight.cell : undefined;

  return (
    <Sheet title={`${t(DOCUMENT_TYPE_KEY[doc.detectedType])} · ${doc.fileName}`} onClose={onClose}>
      {error && <p className="error sheet-body">{error}</p>}
      {!data && !error && (
        <p className="muted sheet-body" role="status">
          {t('viewer.loading')}
        </p>
      )}
      {data && pages.length > 1 && (
        <div className="sheet-tabs">
          <ToggleChips
            value={String(page)}
            options={pages.map((p) => ({ value: String(p), label: data.sheets[p - 1]?.name ?? String(p) }))}
            onValueChange={(v) => setPage(Number(v))}
            ariaLabel={t('viewer.sheetTab')}
          />
        </div>
      )}
      {cell && <p className="viewer-live muted small">{t('viewer.cellShown', { cell })}</p>}
      {sheet && (
        <div className="sheet-grid" tabIndex={0} role="region" aria-label={t('viewer.sheetTable', { sheet: sheet.name })}>
          <table>
            <caption className="visually-hidden">{t('viewer.sheetTable', { sheet: sheet.name })}</caption>
            <thead>
              <tr>
                <td />
                {Array.from({ length: width }, (_, c) => (
                  <th key={c} scope="col">
                    {columnLetters(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sheet.rows.map((row, r) => (
                <tr key={r}>
                  <th scope="row">{r + 1}</th>
                  {Array.from({ length: width }, (_, c) => {
                    const ref = `${columnLetters(c)}${r + 1}`;
                    const isCited = ref === cell;
                    return (
                      <td key={c} ref={isCited ? cited : undefined} className={isCited ? 'sheet-cell-cited' : undefined} aria-current={isCited ? 'true' : undefined}>
                        {row[c] ?? ''}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Sheet>
  );
}
