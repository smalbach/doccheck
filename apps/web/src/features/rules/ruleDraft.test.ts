import { describe, expect, it } from 'vitest';
import type { RuleSettings } from '../../api/types';
import { configOf, draftOf } from './ruleDraft';

const settings: RuleSettings = {
  scope: 'organization',
  config: { rules: { X8: { enabled: false } }, params: { grossWeightTolerance: 0.01, knownScacs: ['EXLN'] } },
  defaults: { grossWeightTolerance: 0.005, shipmentDateDays: 7, vgmTolerance: 0.05, priceDeviation: 0.3, priceScore: 3.5, priceMinHistory: 5, poQuantityTolerance: 0.05, poPriceTolerance: 0.02, isfLeadHours: 24, knownScacs: [] },
  bundledScacs: ['MAEU'],
  rules: [
    { id: 'X3', title: 'Gross weight', appliesTo: 'ALL', requires: [], kind: 'DETERMINISTIC', severity: 'MEDIUM', destinations: ['CA', 'US'], params: [{ key: 'grossWeightTolerance', unit: 'percent', min: 0, max: 0.2 }] },
    { id: 'X8', title: 'Invoice reference', appliesTo: 'ALL', requires: [], kind: 'DETERMINISTIC', severity: 'LOW', destinations: ['CA', 'US'] },
    { id: 'X9', title: 'Dates', appliesTo: 'ALL', requires: [], kind: 'DETERMINISTIC', severity: 'LOW', destinations: ['CA', 'US'], params: [{ key: 'shipmentDateDays', unit: 'days', min: 0, max: 60 }] },
  ],
};

describe('rule settings draft', () => {
  it('shows percents as percentages and round-trips the stored config', () => {
    const d = draftOf(settings);
    expect(d.params).toEqual({ grossWeightTolerance: '1', shipmentDateDays: '7' });
    expect(d.enabled).toEqual({ X3: true, X8: false, X9: true });
    expect(d.scacs).toBe('EXLN');
    expect(configOf(settings, d)).toEqual({ config: settings.config });
  });

  it('keeps only what differs from the defaults', () => {
    const d = { ...draftOf(settings), params: { grossWeightTolerance: '0.5', shipmentDateDays: '10' }, severity: { X3: 'HIGH', X8: 'default', X9: 'default' }, enabled: { X3: true, X8: true, X9: true }, scacs: 'abcd efgh, ABCD' };
    expect(configOf(settings, d)).toEqual({ config: { rules: { X3: { severity: 'HIGH' } }, params: { shipmentDateDays: 10, knownScacs: ['ABCD', 'EFGH'] } } });
  });

  it('refuses values out of bounds, fractional days and bad SCACs', () => {
    const d = draftOf(settings);
    expect(configOf(settings, { ...d, params: { ...d.params, grossWeightTolerance: '25' } })).toEqual({ error: { key: 'grossWeightTolerance', spec: settings.rules[0]?.params?.[0] } });
    expect(configOf(settings, { ...d, params: { ...d.params, shipmentDateDays: '2.5' } })).toMatchObject({ error: { key: 'shipmentDateDays' } });
    expect(configOf(settings, { ...d, scacs: 'TOOLONG' })).toEqual({ error: { key: 'scacs' } });
  });
});
