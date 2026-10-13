import type { SkippedRule } from '../../api/types';
import { DOCUMENT_TYPE_LABEL } from '../../constants/documentTypes';

export function SkippedRules({ skipped }: { skipped: readonly SkippedRule[] }) {
  if (skipped.length === 0) return null;
  return (
    <p className="muted small">
      Not checked: {skipped.map((s) => `${s.ruleId} (needs ${s.missing.map((m) => DOCUMENT_TYPE_LABEL[m]).join(', ')})`).join('; ')}.
    </p>
  );
}
