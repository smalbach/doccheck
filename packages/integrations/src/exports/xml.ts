/** A minimal XML writer: elements with text or children; empty ones are left out. */
export type Node = { name: string; attrs?: Record<string, string>; children: (Node | null | undefined)[] } | { name: string; text: string };

const escape = (s: string) =>
  s
    // Characters XML 1.0 cannot hold at all.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** An element with text; null when the value is missing or blank, so it is not written. */
export const t = (name: string, value: string | number | undefined | null): Node | null =>
  value === undefined || value === null || String(value).trim() === '' ? null : { name, text: String(value) };

/** An element with children; null when none of them is present. */
export const e = (name: string, children: (Node | null | undefined)[], attrs?: Record<string, string>): Node | null =>
  children.some(Boolean) ? { name, attrs, children } : null;

/** <Name><Code>value</Code></Name>, CargoWise's shape for coded values. */
export const code = (name: string, value: string | undefined | null, extra: (Node | null)[] = []): Node | null => e(name, [t('Code', value), ...extra]);

export function render(node: Node, indent = ''): string {
  if ('text' in node) return `${indent}<${node.name}>${escape(node.text)}</${node.name}>`;
  const attrs = Object.entries(node.attrs ?? {}).map(([k, v]) => ` ${k}="${escape(v)}"`).join('');
  const kids = node.children.filter((c): c is Node => !!c);
  if (!kids.length) return `${indent}<${node.name}${attrs}/>`;
  return `${indent}<${node.name}${attrs}>\n${kids.map((c) => render(c, `${indent}  `)).join('\n')}\n${indent}</${node.name}>`;
}
