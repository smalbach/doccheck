import { Tag } from '../../components/ui/Tag';
import { useI18n } from '../../i18n/useI18n';

/** "62% sure", toned by whether it is under the review threshold. */
export function ConfidenceTag({ confidence, low }: { confidence: number; low: boolean }) {
  const { t } = useI18n();
  return <Tag tone={low ? 'accent' : 'ok'}>{t('reviewQueue.confidence', { percent: Math.round(confidence * 100) })}</Tag>;
}
