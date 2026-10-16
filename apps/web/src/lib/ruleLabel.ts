import type { MessageKey } from '../i18n/keys';

/** "X3 · The gross weight differs…" from the rule guide; the bare id for a rule the guide does not know. */
export function ruleLabel(t: (key: MessageKey) => string, ruleId: string): string {
  const key = `ruleGuide.${ruleId}.problem` as MessageKey;
  const text = t(key);
  return text === key ? ruleId : `${ruleId} · ${text}`;
}
