import type { ShipmentDocument } from '../../api/types';

export interface Highlight {
  page: number;
  /** [x0, y0, x1, y1] in PDF points, origin top-left (as stored by the extraction). */
  bbox?: [number, number, number, number];
}

/** A document to open in the viewer, optionally at a cited line. */
export interface ViewerTarget {
  doc: ShipmentDocument;
  highlight?: Highlight;
}
