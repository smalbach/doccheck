import { describe, expect, it } from 'vitest';
import { columnLetters } from './columnLetters';
import { isUploadableFile } from './isUploadableFile';

describe('spreadsheet columns and uploads', () => {
  it('names columns like a spreadsheet', () => {
    expect([0, 2, 25, 26, 27, 701, 702].map(columnLetters)).toEqual(['A', 'C', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
  });
  it('takes PDFs, photos and spreadsheets, by type or extension', () => {
    const file = (name: string, type = '') => new File(['x'], name, { type });
    expect([file('a.pdf'), file('IMG_0042.HEIC'), file('photo', 'image/jpeg'), file('pl.CSV'), file('inv.xlsx')].every(isUploadableFile)).toBe(true);
    expect([file('notes.docx'), file('old.xls')].some(isUploadableFile)).toBe(false);
  });
});
