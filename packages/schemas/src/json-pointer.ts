/**
 * JSON pointers (RFC 6901) into a normalized document, for values corrected by hand:
 * "/lines/0/quantity/value". Only scalar values are corrected; objects and arrays keep their shape.
 */

export type Scalar = string | number | boolean | null;

export interface PointerChange {
  path: string;
  /** null removes an optional field. */
  value: Scalar;
}

export interface PointerIssue {
  path: string;
  message: string;
}

const isContainer = (v: unknown): v is Record<string, unknown> | unknown[] => typeof v === 'object' && v !== null;

/** The segments of a pointer ("" is the whole document), or undefined when it is not one. */
export function parsePointer(pointer: string): string[] | undefined {
  if (pointer === '') return [];
  if (!pointer.startsWith('/')) return undefined;
  return pointer.slice(1).split('/').map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
}

export function toPointer(segments: readonly (string | number)[]): string {
  return segments.map((s) => `/${String(s).replace(/~/g, '~0').replace(/\//g, '~1')}`).join('');
}

/** A field as the rules cite it in evidence ("lines[2].quantity") as a pointer ("/lines/2/quantity"). */
export function fieldPointer(field: string): string {
  return toPointer(field.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean));
}

/** The value at a pointer, or undefined. */
export function readPointer(doc: unknown, pointer: string): unknown {
  const segments = parsePointer(pointer);
  if (!segments) return undefined;
  return segments.reduce<unknown>((current, key) => (isContainer(current) ? (current as Record<string, unknown>)[key] : undefined), doc);
}

/**
 * Applies the changes to a copy of the document. A change may replace a scalar or add an absent field
 * to an existing object; it cannot replace an object or an array, nor add array items.
 */
export function applyPointerChanges<T>(doc: T, changes: readonly PointerChange[]): { data: T; issues: PointerIssue[] } {
  const data = structuredClone(doc);
  const issues: PointerIssue[] = [];
  for (const { path, value } of changes) {
    const segments = parsePointer(path);
    if (!segments || segments.length === 0) {
      issues.push({ path, message: 'Not a JSON pointer to a field' });
      continue;
    }
    const key = segments[segments.length - 1];
    const parent = segments.slice(0, -1).reduce<unknown>((current, k) => (isContainer(current) ? (current as Record<string, unknown>)[k] : undefined), data);
    if (!isContainer(parent)) {
      issues.push({ path, message: 'No such field in the document' });
      continue;
    }
    if (Array.isArray(parent)) {
      if (!/^\d+$/.test(key) || Number(key) >= parent.length) issues.push({ path, message: 'No such item in the list' });
      else if (isContainer(parent[Number(key)]) || value === null) issues.push({ path, message: 'Only single values can be corrected' });
      else parent[Number(key)] = value;
      continue;
    }
    if (isContainer(parent[key])) {
      issues.push({ path, message: 'Only single values can be corrected' });
      continue;
    }
    if (value === null) delete parent[key];
    else parent[key] = value;
  }
  return { data, issues };
}

/** Pointers to the scalar values that differ between two documents (added or removed ones included). */
export function diffPointers(a: unknown, b: unknown, prefix: (string | number)[] = []): string[] {
  if (isContainer(a) && isContainer(b) && Array.isArray(a) === Array.isArray(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].flatMap((k) => diffPointers((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], [...prefix, k]));
  }
  if (isContainer(a) || isContainer(b)) {
    // An object against a scalar or nothing: every scalar inside it differs.
    const inner = isContainer(a) ? a : (b as Record<string, unknown>);
    return Object.keys(inner).flatMap((k) => diffPointers(isContainer(a) ? (a as Record<string, unknown>)[k] : undefined, isContainer(b) ? (b as Record<string, unknown>)[k] : undefined, [...prefix, k]));
  }
  return a === b ? [] : [toPointer(prefix)];
}
