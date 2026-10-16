import { describe, expect, it } from 'vitest';
import type { ShipmentDocument, ValidationFinding } from '../api/types';
import { es } from '../i18n/messages/es';
import type { MessageKey, MessageVars } from '../i18n/keys';
import { translate } from '../i18n/translate';
import { evidencePointer, isClosed, matchesFilter, reviewStatus, ruleGuideKey } from './findingReview';
import { supplierLetter } from './supplierLetter';

const finding = (over: Partial<ValidationFinding> = {}): ValidationFinding => ({
  id: 'f-1',
  shipmentId: 's-1',
  ruleId: 'X2',
  severity: 'HIGH',
  decidedBy: 'RULE',
  message: 'Package count differs',
  evidence: [
    { documentId: 'inv', field: 'packageCount', value: '120' },
    { documentId: 'bl', field: 'totalPackages', value: '' },
  ],
  fingerprint: 'a'.repeat(32),
  ...over,
});

describe('finding reviews', () => {
  it('reads the status, and closes only accepted and false positives', () => {
    expect(reviewStatus(finding())).toBe('open');
    const waiting = finding({ review: { status: 'waiting_supplier', at: '2026-10-13T10:00:00Z' } });
    expect([isClosed(waiting), matchesFilter(waiting, 'open'), matchesFilter(waiting, 'waiting'), matchesFilter(waiting, 'closed')]).toEqual([false, true, true, false]);
    const accepted = finding({ review: { status: 'accepted', note: 'spare', at: '2026-10-13T10:00:00Z' } });
    expect([isClosed(accepted), matchesFilter(accepted, 'closed'), matchesFilter(accepted, 'all')]).toEqual([true, true, true]);
  });

  it('turns an evidence field into the pointer of the correction form', () => {
    expect(evidencePointer('lines[2].quantity.value')).toBe('/lines/2/quantity/value');
    expect(evidencePointer('totals.grossWeight.kg')).toBe('/totals/grossWeight/kg');
    expect(evidencePointer('containers[0].number')).toBe('/containers/0/number');
  });

  it('has a guide for known rules only', () => {
    expect(ruleGuideKey('X2', 'action')).toBe('ruleGuide.X2.action');
    expect(ruleGuideKey('Z9', 'problem')).toBeUndefined();
  });

  it('writes the supplier letter in the language asked for, with each value', () => {
    const t = (key: MessageKey, vars?: MessageVars) => translate(es, 'es', key, vars);
    const documents = new Map([
      ['inv', { id: 'inv', detectedType: 'COMMERCIAL_INVOICE' } as ShipmentDocument],
      ['bl', { id: 'bl', detectedType: 'BILL_OF_LADING' } as ShipmentDocument],
    ]);
    const { subject, body } = supplierLetter(t, { reference: 'PO-1', findings: [finding()], documents });
    expect(subject).toBe('Correcciones necesarias: envío PO-1');
    expect(body).toContain('1. El número de bultos no coincide entre documentos.');
    expect(body).toContain('   - Factura comercial · packageCount: 120');
    expect(body).toContain('totalPackages: (no aparece)');
    expect(body).toContain('Qué corregir: Confirma el conteo físico');
  });
});
