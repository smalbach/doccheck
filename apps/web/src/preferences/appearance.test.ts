import { describe, expect, it } from 'vitest';
import { customAccentVars, DEFAULT_APPEARANCE, parseAppearance, readableOn } from './appearance';

describe('parseAppearance', () => {
  it('falls back to defaults for missing, corrupt or unknown values', () => {
    expect(parseAppearance(null)).toEqual(DEFAULT_APPEARANCE);
    expect(parseAppearance('{not json')).toEqual(DEFAULT_APPEARANCE);
    expect(parseAppearance('{"radius":"huge","customAccent":"red"}')).toEqual(DEFAULT_APPEARANCE);
  });

  it('keeps known choices field by field', () => {
    const parsed = parseAppearance('{"accent":"custom","customAccent":"#AA3366","panels":"shadow","tone":"bogus"}');
    expect(parsed).toEqual({ ...DEFAULT_APPEARANCE, accent: 'custom', customAccent: '#aa3366', panels: 'shadow' });
  });
});

describe('custom accent', () => {
  it('picks readable text on light and dark colours', () => {
    expect(readableOn('#1d4ed8')).toBe('#ffffff');
    expect(readableOn('#fde68a')).toBe('#111416');
  });

  it('nudges colours only as far as needed for AA contrast on each background', () => {
    const pale = customAccentVars('#fde68a');
    expect(pale['accent-l']).not.toBe('#fde68a');
    expect(pale['accent-d']).toBe('#fde68a');
    const deep = customAccentVars('#1e3a8a');
    expect(deep['accent-l']).toBe('#1e3a8a');
    expect(deep['accent-d']).not.toBe('#1e3a8a');
    expect(deep['on-accent-l']).toBe('#ffffff');
    expect(customAccentVars('#7c3aed')['accent-l']).toBe('#7c3aed');
  });
});
