import { describe, expect, it } from 'vitest';
import { allocate, ceil, clamp, dec, div, fmt, fmtRate, mul, pct, round } from './decimal';
import { applyRate, normalizeUnit, parseRate, parseSpecialColumn, rateLabel } from './rates';

describe('fixed-point decimals', () => {
  it('parses and formats without floats', () => {
    expect(fmt(dec('12500.00'))).toBe('12500.00');
    expect(fmt(dec('0.1') + dec('0.2'))).toBe('0.30');
    expect(fmt(dec('-3.5'), 0)).toBe('-4');
    expect(() => dec('1,250.00')).toThrow();
  });

  it('rounds half away from zero', () => {
    expect(fmt(dec('2.345'))).toBe('2.35');
    expect(fmt(dec('-2.345'))).toBe('-2.35');
    expect(fmt(dec('2.344'))).toBe('2.34');
    expect(fmt(round(dec('9149.50'), 0), 0)).toBe('9150');
    expect(fmt(ceil(dec('1.001')))).toBe('1.01');
  });

  it('multiplies and divides exactly enough for rates', () => {
    // MPF on an entered value of 9,150: 0.3464 % = 31.6956
    expect(fmt(pct(dec('9150'), dec('0.3464')), 4)).toBe('31.6956');
    expect(fmt(mul(dec('18500'), dec('1.5')))).toBe('27750.00');
    // 7,100 CNY at 7.1000 CNY per USD = 1,000.00 USD
    expect(fmt(div(dec('7100'), dec('7.1')))).toBe('1000.00');
    expect(fmtRate(div(dec('1'), dec('3')))).toBe('0.333333');
    expect(fmt(clamp(dec('31.6956'), dec('34.58'), dec('670.86')))).toBe('34.58');
  });

  it('allocates a total over weights so the parts add up', () => {
    expect(allocate(dec('100'), [dec('1'), dec('1'), dec('1')]).map((x) => fmt(x))).toEqual(['33.34', '33.33', '33.33']);
    expect(allocate(dec('850'), [dec('7500'), dec('2500')]).map((x) => fmt(x))).toEqual(['637.50', '212.50']);
    expect(allocate(dec('0.05'), [dec('0'), dec('0')]).map((x) => fmt(x))).toEqual(['0.03', '0.02']);
    expect(allocate(dec('-10'), [dec('1'), dec('2')]).map((x) => fmt(x))).toEqual(['-3.33', '-6.67']);
  });
});

describe('duty rates as printed', () => {
  it('parses ad valorem, specific, compound and bounded rates', () => {
    expect(parseRate('Free').free).toBe(true);
    expect(parseRate('Free¹').free).toBe(true);
    expect(fmtRate(parseRate('9%').percent!)).toBe('9');
    expect(fmtRate(parseRate('18 %').percent!)).toBe('18');
    const oil = parseRate('5¢/kg on contents and container');
    expect(fmtRate(oil.specific!.amount)).toBe('0.05');
    expect(oil.specific!.per).toBe('kg');
    const wine = parseRate('4.68 ¢/litre');
    expect(fmtRate(wine.specific!.amount)).toBe('0.0468');
    expect(wine.specific!.per).toBe('l');
    const compound = parseRate('1.5¢/kg + 5%');
    expect(fmtRate(compound.specific!.amount)).toBe('0.015');
    expect(fmtRate(compound.percent!)).toBe('5');
    expect(parseRate('$1.035/kg').specific!.amount).toBe(dec('1.035'));
    const bounded = parseRate('9.5% but not less than 4.62¢/kg');
    expect(fmtRate(bounded.minimum!.amount)).toBe('0.0462');
    expect(parseRate('The rate applicable to the natural juice in heading 2009').unparsed).toBe(true);
  });

  it('reads the HTSUS special column per program', () => {
    const s = parseSpecialColumn('Free (A+,AU,B,BH,CL) 3.1% (JP)');
    expect(s).toHaveLength(2);
    expect(s[0].programs).toEqual(['A+', 'AU', 'B', 'BH', 'CL']);
    expect(s[1].rate.text).toBe('3.1%');
  });

  it('applies a rate to value and quantity', () => {
    // 1,840 kg of olive oil at 5¢/kg = 92.00
    expect(fmt(applyRate(parseRate('5¢/kg'), dec('13568'), { kg: dec('1840') }).amount!)).toBe('92.00');
    // 9.5 % of 100 = 9.50, but not less than 4.62¢ × 500 kg = 23.10
    expect(fmt(applyRate(parseRate('9.5% but not less than 4.62¢/kg'), dec('100'), { kg: dec('500') }).amount!)).toBe('23.10');
    expect(applyRate(parseRate('5¢/kg'), dec('100'), { no: dec('10') }).missingUnit).toBe('kg');
    expect(applyRate(parseRate('see note'), dec('100'), {}).unparsed).toBe(true);
    expect(rateLabel(parseRate('1.5¢/kg + 5%'))).toBe('0.015/kg + 5%');
  });

  it('normalizes units from tariffs and invoices', () => {
    expect(normalizeUnit('KGM')).toBe('kg');
    expect(normalizeUnit('PCS')).toBe('no');
    expect(normalizeUnit('No.')).toBe('no');
    expect(normalizeUnit('LTR')).toBe('l');
    expect(normalizeUnit('MTK')).toBe('m2');
    expect(normalizeUnit('PRS')).toBe('pr');
    expect(normalizeUnit('furlong')).toBeUndefined();
  });
});
