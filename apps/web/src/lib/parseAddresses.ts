const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

/** "a@x.com, B <b@y.com>; c@z.com" → the addresses, and the parts that are not one. */
export function parseAddresses(text: string): { addresses: string[]; invalid: string[] } {
  const parts = text
    .split(/[,;\n]+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => (/<([^>]+)>/.exec(p)?.[1] ?? p).trim().toLowerCase());
  return { addresses: [...new Set(parts.filter((p) => EMAIL.test(p)))], invalid: parts.filter((p) => !EMAIL.test(p)) };
}
