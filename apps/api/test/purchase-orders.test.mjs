// Purchase order CSV import for rule X24 (built API: npm run build first).
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { parsePurchaseOrdersCsv, poKey } = require('../dist/rules/purchase-orders.js');

describe('purchase order CSV', () => {
  it('groups rows by PO number and reads decimals as printed', () => {
    const csv = '﻿PO Number;Line;SKU;Description;Qty;UOM;Unit Price;Currency;Supplier\r\n'
      + 'PO-1;1;A-1;"Bolts; M8";1.200,5;KG;2,40;eur;Acme\r\n'
      + 'PO-1;2;;Nuts;500;PCS;0,10;EUR;Acme\r\n'
      + 'po 2;1;B-2;;10;;;;\r\n';
    const { orders, errors } = parsePurchaseOrdersCsv(csv);
    assert.deepEqual(errors, []);
    assert.equal(orders.length, 2);
    assert.deepEqual(orders[0], {
      poNumber: 'PO-1',
      currency: 'EUR',
      sellerName: 'Acme',
      lines: [
        { lineNo: 1, sku: 'A-1', description: 'Bolts; M8', quantity: '1200.5', unit: 'KG', unitPrice: '2.40' },
        { lineNo: 2, description: 'Nuts', quantity: '500', unit: 'PCS', unitPrice: '0.10' },
      ],
    });
    assert.deepEqual(orders[1], { poNumber: 'po 2', lines: [{ lineNo: 1, sku: 'B-2', quantity: '10' }] });
    assert.equal(poKey('po 2'), poKey('PO-2'));
  });

  it('names missing columns and bad rows', () => {
    assert.deepEqual(parsePurchaseOrdersCsv('SKU,Qty\nA,1\n').errors, ['Missing column: PO number.']);
    const { errors } = parsePurchaseOrdersCsv('PO,SKU,Qty,Price\nPO-1,A,many,1\nPO-1,,2,1\nPO-1,B,2,x\n');
    assert.deepEqual(errors, ['Row 2: quantity "many" is not a number.', 'Row 3: no SKU or description.', 'Row 4: unit price "x" is not a number.']);
  });
});
