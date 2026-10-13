import type { Rule } from '../types';

/**
 * ISO 6346 check digit. Letters map to 10..38 skipping multiples of 11 (A=10, B=12, ... Z=38);
 * each of the first 10 characters is multiplied by 2^position, the sum mod 11 is the digit (10 -> 0).
 */
export function iso6346CheckDigit(first10: string): number {
  const letterValue = (ch: string): number => {
    let value = 10;
    for (let c = 'A'.charCodeAt(0); c < ch.charCodeAt(0); c++) {
      value++;
      if (value % 11 === 0) value++;
    }
    return value;
  };
  let total = 0;
  for (let i = 0; i < 10; i++) {
    const ch = first10[i];
    const v = /[0-9]/.test(ch) ? Number(ch) : letterValue(ch);
    total += v * 2 ** i;
  }
  return (total % 11) % 10;
}

export function isValidContainerNumber(number: string): boolean {
  if (!/^[A-Z]{3}[UJZ][0-9]{7}$/.test(number)) return false;
  return iso6346CheckDigit(number.slice(0, 10)) === Number(number[10]);
}

/** X10: each container number on the BL has a valid ISO 6346 check digit. */
export const x10ContainerCheckDigit: Rule = {
  definition: {
    id: 'X10',
    title: 'Container numbers have a valid ISO 6346 check digit',
    appliesTo: 'ALL',
    requires: ['BILL_OF_LADING'],
    kind: 'DETERMINISTIC',
    severity: 'MEDIUM',
  },
  run(ctx) {
    if (!ctx.billOfLading) return [];
    const { id, data } = ctx.billOfLading;
    return data.containers
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => !isValidContainerNumber(c.number))
      .map(({ c, i }) => ({
        message: `Container ${c.number} fails the ISO 6346 check digit; it is probably mistyped.`,
        evidence: [{ documentId: id, field: `containers[${i}].number`, value: c.number }],
        suggestedFix: 'Compare against the container itself or the carrier booking confirmation.',
      }));
  },
};
