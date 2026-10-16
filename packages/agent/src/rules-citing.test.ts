import { describe, expect, it } from 'vitest';
import { rulesCiting } from './cite';

describe('rulesCiting', () => {
  it('maps a corpus document to the rules that may cite it, per destination', () => {
    const ca = rulesCiting('cbsa-d1-4-1-en');
    expect(ca.every((r) => r.destination === 'CA')).toBe(true);
    expect(ca.map((r) => r.ruleId)).toEqual(expect.arrayContaining(['X2', 'X5', 'C1', 'C2']));
    expect(ca.map((r) => r.ruleId)).not.toContain('X10');
    const isf = rulesCiting('cfr-19-149');
    expect(isf.every((r) => r.destination === 'US')).toBe(true);
    expect(isf.map((r) => r.ruleId)).toContain('X11');
    expect(rulesCiting('mx-rgce-2026').every((r) => r.destination === 'MX')).toBe(true);
    expect(rulesCiting('cfr-19-141-86').map((r) => r.ruleId)).toEqual(expect.arrayContaining(['U1', 'X5']));
    expect(rulesCiting('cfr-19-141-86').map((r) => r.ruleId)).not.toContain('X11');
    // Searchable but never cited.
    expect(rulesCiting('cbsa-d11-3-1-en')).toEqual([]);
  });
});
