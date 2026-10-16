import type { Rule, RuleResult } from '../types';

/**
 * IATA air waybill check digit: the 7-digit serial number (after the 3-digit airline prefix) mod 7.
 * "176-12345675": 1234567 mod 7 = 5. Takes the number with or without the dash and spaces.
 */
export function awbCheckDigit(serial7: string): number {
  return Number(BigInt(serial7) % 7n);
}

/** Digits of an IATA-format air waybill number, or undefined when it is not one (11 digits). */
const awbDigits = (number: string) => {
  const digits = number.replace(/[\s-]/g, '');
  return /^\d{11}$/.test(digits) ? digits : undefined;
};

export function isValidAwbNumber(number: string): boolean {
  const digits = awbDigits(number);
  return !!digits && awbCheckDigit(digits.slice(3, 10)) === Number(digits[10]);
}

/**
 * T1: the air waybill number has a valid check digit. A master waybill always has one; a house
 * waybill's own number is the forwarder's and is only checked when it is printed in the IATA format,
 * but the master number it quotes is checked.
 */
export const t1AwbCheckDigit: Rule = {
  definition: {
    id: 'T1',
    title: 'Air waybill number has a valid check digit',
    appliesTo: 'ALL',
    requires: ['AIR_WAYBILL'],
    kind: 'DETERMINISTIC',
    severity: 'MEDIUM',
    optional: true,
  },
  run(ctx) {
    if (!ctx.airWaybill) return [];
    const { id, data } = ctx.airWaybill;
    const results: RuleResult[] = [];
    const check = (field: string, value: string | undefined, required: boolean) => {
      if (!value) return;
      const digits = awbDigits(value);
      if (!digits && !required) return;
      if (digits && isValidAwbNumber(value)) return;
      const expected = digits ? awbCheckDigit(digits.slice(3, 10)) : undefined;
      results.push({
        message: digits
          ? `Air waybill number ${value} fails the IATA check digit (the serial ${digits.slice(3, 10)} mod 7 is ${expected}, not ${digits[10]}); it is probably mistyped.`
          : `Air waybill number ${value} is not in the IATA format (3-digit airline prefix and 8 digits).`,
        evidence: [{ documentId: id, field, value }],
        suggestedFix: 'Compare against the airline booking or the master air waybill and have the number corrected.',
      });
    };
    check('awbNumber', data.awbNumber, data.issuer !== 'HAWB');
    check('masterAwbNumber', data.masterAwbNumber, true);
    return results;
  },
};
