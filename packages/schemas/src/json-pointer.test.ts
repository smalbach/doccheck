import { describe, expect, it } from 'vitest';
import { sampleInvoice } from './fixtures';
import { applyPointerChanges, diffPointers, fieldPointer, parsePointer, readPointer, toPointer } from './json-pointer';

describe('JSON pointers', () => {
  it('parses and builds pointers with escapes', () => {
    expect(parsePointer('/a~1b/c~0d/0')).toEqual(['a/b', 'c~d', '0']);
    expect(parsePointer('lines')).toBeUndefined();
    expect(toPointer(['a/b', 'c~d', 0])).toBe('/a~1b/c~0d/0');
    expect(fieldPointer('lines[2].quantity')).toBe('/lines/2/quantity');
    expect(readPointer(sampleInvoice, '/lines/0/quantity/value')).toBe(sampleInvoice.lines[0].quantity.value);
  });

  it('applies scalar changes to a copy, adds and removes optional fields', () => {
    const doc = { ...sampleInvoice, poNumber: undefined };
    delete doc.poNumber;
    const { data, issues } = applyPointerChanges(doc, [
      { path: '/lines/0/quantity/value', value: '7' },
      { path: '/poNumber', value: 'PO-9' },
      { path: '/invoiceDate', value: null },
    ]);
    expect(issues).toEqual([]);
    expect(data.lines[0].quantity.value).toBe('7');
    expect(data.poNumber).toBe('PO-9');
    expect('invoiceDate' in data).toBe(false);
    expect(doc.lines[0].quantity.value).not.toBe('7');
    expect(diffPointers(doc, data).sort()).toEqual(['/invoiceDate', '/lines/0/quantity/value', '/poNumber']);
  });

  it('refuses to replace objects, add list items or reach missing parents', () => {
    const end = sampleInvoice.lines.length;
    const { issues } = applyPointerChanges(sampleInvoice, [
      { path: '/seller', value: 'x' },
      { path: `/lines/${end}/sku`, value: 'x' },
      { path: `/lines/${end}`, value: 'x' },
      { path: '/nothing/here', value: 'x' },
      { path: 'invoiceNumber', value: 'x' },
    ]);
    expect(issues.map((i) => i.path)).toEqual(['/seller', `/lines/${end}/sku`, `/lines/${end}`, '/nothing/here', 'invoiceNumber']);
  });
});
