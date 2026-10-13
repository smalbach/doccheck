import type { Messages } from './messages/en';
import type { MessageKey, MessageVars } from './keys';
import type { Locale } from './locales';

const pluralRules = new Map<Locale, Intl.PluralRules>();

function plural(locale: Locale, count: number): 'one' | 'other' {
  let rules = pluralRules.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    pluralRules.set(locale, rules);
  }
  return rules.select(count) === 'one' ? 'one' : 'other';
}

/**
 * The text for a key with {placeholders} filled in. A { one, other } entry picks its form from
 * vars.count with the language's plural rules (French treats 0 as singular, English does not).
 */
export function translate(messages: Messages, locale: Locale, key: MessageKey, vars: MessageVars = {}): string {
  const entry = key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], messages);
  let text: string;
  if (typeof entry === 'string') text = entry;
  else if (entry && typeof entry === 'object' && 'other' in entry) {
    const forms = entry as { one: string; other: string };
    text = forms[plural(locale, Number(vars.count ?? 0))];
  } else text = key;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}
