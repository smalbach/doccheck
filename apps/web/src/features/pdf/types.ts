import type { ShipmentDocument } from '../../api/types';

export interface Highlight {
  page: number;
  /** [x0, y0, x1, y1] in PDF points, origin top-left (as stored by the extraction). */
  bbox?: [number, number, number, number];
  /** Spreadsheets: the cited cell ("C12") of the sheet named `sheet` (page is the sheet's position). */
  cell?: string;
  sheet?: string;
}

/** A document to open in the viewer, optionally at a cited line. */
export interface ViewerTarget {
  doc: ShipmentDocument;
  highlight?: Highlight;
}
