import { describe, expect, it } from 'vitest';
import { estimateCost, estimatedArrival, type CostFinding, type CostShipment } from './cost';
import { CostAssumptions, DEFAULT_COST_ASSUMPTIONS } from './penalties';

const ship = (id: string, over: Partial<CostShipment> = {}): CostShipment => ({ shipmentId: id, destination: 'CA', containers: 1, departure: '2026-03-01', createdAt: '2026-02-20T10:00:00Z', ...over });
const finding = (shipmentId: string, ruleId: string, severity: string, resolvedAt?: string, dismissed = false): CostFinding => ({ shipmentId, ruleId, severity, resolvedAt, dismissed });

describe('estimateCost', () => {
  it('is valid against its own schema', () => {
    expect(CostAssumptions.parse(DEFAULT_COST_ASSUMPTIONS)).toEqual(DEFAULT_COST_ASSUMPTIONS);
  });

  it('arrives after the transit days of the mode, counting the whole arrival day', () => {
    expect(estimatedArrival(ship('a'), DEFAULT_COST_ASSUMPTIONS).toISOString()).toBe('2026-03-15T23:59:59.999Z');
    expect(estimatedArrival(ship('a', { departure: undefined, transportMode: 'AIR' }), DEFAULT_COST_ASSUMPTIONS).toISOString().slice(0, 10)).toBe('2026-02-22');
  });

  it('charges a penalty once per shipment and the hold per container, by the findings\' fate', () => {
    const est = estimateCost(
      [ship('a', { containers: 2 }), ship('b'), ship('c', { destination: 'US' }), ship('d')],
      [
        finding('a', 'X2', 'HIGH', '2026-03-05T12:00:00Z'),
        finding('a', 'X5', 'HIGH', '2026-03-10T12:00:00Z'),
        finding('b', 'X9', 'LOW', '2026-04-01T00:00:00Z'), // after arrival
        finding('c', 'X11', 'HIGH'), // still open
        finding('d', 'X2', 'HIGH', undefined, true), // accepted as a risk
      ],
      DEFAULT_COST_ASSUMPTIONS,
    );
    expect(est.items.map((i) => [i.shipmentId, i.item, i.outcome, i.amount, i.currency, i.ruleIds.join()])).toEqual([
      ['a', 'cbsa-amps-c005', 'avoided', '150.00', 'CAD', 'X2,X5'],
      ['a', 'delay', 'avoided', '800.00', 'CAD', 'X2,X5'],
      ['b', 'cbsa-amps-c005', 'late', '150.00', 'CAD', 'X9'],
      ['c', 'cbp-isf-ld', 'exposed', '5000.00', 'USD', 'X11'],
      ['c', 'delay', 'exposed', '400.00', 'USD', 'X11'],
    ]);
    expect(est.totals).toEqual({
      avoided: [{ amount: '950.00', currency: 'CAD' }],
      late: [{ amount: '150.00', currency: 'CAD' }],
      exposed: [{ amount: '5400.00', currency: 'USD' }],
    });
  });

  it('counts a penalty as exposed while any of its findings is open', () => {
    const est = estimateCost([ship('a')], [finding('a', 'X2', 'LOW', '2026-03-02T00:00:00Z'), finding('a', 'X3', 'LOW')], DEFAULT_COST_ASSUMPTIONS);
    expect(est.items.map((i) => i.outcome)).toEqual(['exposed']);
  });

  it('follows edited assumptions, with exact decimals', () => {
    const a = { ...DEFAULT_COST_ASSUMPTIONS, penalties: [{ ...DEFAULT_COST_ASSUMPTIONS.penalties[0], amount: '0.10' }], delay: { ...DEFAULT_COST_ASSUMPTIONS.delay, days: 3, perDay: { CA: { amount: '0.10', currency: 'CAD' }, US: { amount: '1', currency: 'USD' } } } };
    const est = estimateCost([ship('a'), ship('b')], [finding('a', 'X2', 'HIGH', '2026-03-02T00:00:00Z'), finding('b', 'X2', 'HIGH', '2026-03-02T00:00:00Z')], a);
    expect(est.totals.avoided).toEqual([{ amount: '0.80', currency: 'CAD' }]);
  });
});
