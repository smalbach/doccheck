import { describe, expect, it } from 'vitest';
import { isOutlier, priceStats } from './price-stats';
import { median, supplierScore } from './score';

describe('supplierScore', () => {
  it('weighs first pass, correction and responsiveness 50/30/20', () => {
    const s = supplierScore({ validatedShipments: 10, cleanFirstPass: 8, requestedFindings: 4, correctedFindings: 3, responseHours: [12, 36, 24] });
    expect(s.components).toEqual({ firstPass: 0.8, correction: 0.75, responsiveness: 0.8 });
    expect(s.score).toBe(79); // 100 × (0.4 + 0.225 + 0.16)
    expect(s.lowData).toBe(false);
  });

  it('leaves out components without data and rescales the weights', () => {
    const s = supplierScore({ validatedShipments: 2, cleanFirstPass: 1, requestedFindings: 0, correctedFindings: 0, responseHours: [] });
    expect(s.components).toEqual({ firstPass: 0.5, correction: null, responsiveness: null });
    expect(s.score).toBe(50);
    expect(s.lowData).toBe(true);
    expect(supplierScore({ validatedShipments: 0, cleanFirstPass: 0, requestedFindings: 0, correctedFindings: 0, responseHours: [] }).score).toBeNull();
  });

  it('counts an unanswered request as the 120-hour horizon', () => {
    const s = supplierScore({ validatedShipments: 5, cleanFirstPass: 5, requestedFindings: 1, correctedFindings: 0, responseHours: [null] });
    expect(s.components.responsiveness).toBe(0);
    expect(s.score).toBe(50); // 100 × (0.5 + 0 + 0)
  });

  it('takes the median of an even list as the mean of the middle two', () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe('priceStats', () => {
  it('uses nearest-rank quartiles and Tukey fences, in exact decimals', () => {
    const s = priceStats(['10.00', '10.50', '11.00', '9.80', '10.20', '10.10', '25.00', '10.30'])!;
    expect(s).toEqual({ n: 8, min: '9.8000', q1: '10.0000', median: '10.2000', q3: '10.5000', max: '25.0000', low: '9.2500', high: '11.2500' });
    expect(isOutlier('25.00', s)).toBe(true);
    expect(isOutlier('9.80', s)).toBe(false);
    expect(isOutlier('8.70', s)).toBe(true);
  });

  it('marks no outliers with fewer than four prices', () => {
    const s = priceStats(['1', '100', '1000'])!;
    expect([s.low, s.high, isOutlier('1000', s)]).toEqual([undefined, undefined, false]);
    expect(priceStats([])).toBeUndefined();
  });
});
