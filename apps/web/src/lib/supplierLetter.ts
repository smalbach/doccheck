import type { ShipmentDocument, ValidationFinding } from '../api/types';
import { DOCUMENT_TYPE_KEY } from '../constants/documentTypes';
import type { MessageKey, MessageVars } from '../i18n/keys';
import { ruleGuideKey } from './findingReview';

type Translate = (key: MessageKey, vars?: MessageVars) => string;

/**
 * A plain-text message asking the supplier for corrected documents: each finding's problem, the values
 * each document gives and what to correct, in the language `t` speaks (not necessarily the UI's).
 */
export function supplierLetter(t: Translate, opts: { reference: string; findings: readonly ValidationFinding[]; documents: ReadonlyMap<string, ShipmentDocument>; signature?: string }) {
  const subject = t('letter.subject', { reference: opts.reference });
  const items = opts.findings.map((f, i) => {
    const problemKey = ruleGuideKey(f.ruleId, 'problem');
    const actionKey = ruleGuideKey(f.ruleId, 'action');
    const lines = [`${i + 1}. ${problemKey ? t(problemKey) : f.message}`];
    for (const e of f.evidence) {
      const doc = opts.documents.get(e.documentId);
      const label = doc ? t(DOCUMENT_TYPE_KEY[doc.detectedType]) : '';
      lines.push(`   - ${[label, e.field].filter(Boolean).join(' · ')}: ${e.value || `(${t('letter.missing')})`}`);
    }
    if (actionKey) lines.push(`   ${t('letter.whatToDo')}: ${t(actionKey)}`);
    return lines.join('\n');
  });
  const body = [t('letter.greeting'), '', t('letter.intro', { reference: opts.reference }), '', items.join('\n\n'), '', t('letter.closing'), ...(opts.signature ? [opts.signature] : [])].join('\n');
  return { subject, body };
}
