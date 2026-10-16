import { useState, type FormEvent } from 'react';
import type { ScreeningThresholds } from '../../../api/types';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Field } from '../../../components/ui/Field';
import { Tag } from '../../../components/ui/Tag';
import { TextInput } from '../../../components/ui/TextInput';
import { useI18n } from '../../../i18n/useI18n';

export interface ThresholdsCardProps {
  thresholds: ScreeningThresholds;
  editable: boolean;
  busy: boolean;
  onSave: (t: { match: number; review: number }) => void;
  onReset: () => void;
}

const valid = (match: number, review: number) => match >= 0.5 && match <= 1 && review >= 0.5 && review <= match;

/** The S1 and S2 thresholds, where they come from, and a way back to the defaults. */
export function ThresholdsCard({ thresholds, editable, busy, onSave, onReset }: ThresholdsCardProps) {
  const { t, formatDateTime } = useI18n();
  const [match, setMatch] = useState(String(thresholds.match));
  const [review, setReview] = useState(String(thresholds.review));
  const m = Number(match.replace(',', '.'));
  const r = Number(review.replace(',', '.'));
  const ok = valid(m, r);
  const source =
    thresholds.source === 'admin'
      ? thresholds.updatedBy
        ? t('admin.source.admin', { who: thresholds.updatedBy, date: formatDateTime(thresholds.updatedAt ?? '') })
        : t('admin.source.adminNoUser', { date: formatDateTime(thresholds.updatedAt ?? '') })
      : t(`admin.source.${thresholds.source}`);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (ok) onSave({ match: m, review: r });
  };
  return (
    <Card
      title={t('screening.admin.thresholds')}
      aside={
        <span className="setting-source">
          <Tag tone={thresholds.source === 'admin' ? 'accent' : 'neutral'}>{source}</Tag>
          {editable && thresholds.source === 'admin' && (
            <Button variant="link" size="sm" onClick={onReset} disabled={busy}>
              {t('admin.resetDefault')}
            </Button>
          )}
        </span>
      }
    >
      <p className="muted">{t('screening.admin.thresholdsText')}</p>
      <form className="screening-thresholds" onSubmit={submit}>
        <Field label={t('screening.admin.match')}>
          {(id) => <TextInput id={id} type="number" min={0.5} max={1} step={0.005} value={match} onChange={(e) => setMatch(e.target.value)} disabled={!editable} aria-invalid={!ok} />}
        </Field>
        <Field label={t('screening.admin.review')}>
          {(id) => <TextInput id={id} type="number" min={0.5} max={1} step={0.005} value={review} onChange={(e) => setReview(e.target.value)} disabled={!editable} aria-invalid={!ok} />}
        </Field>
        <Button type="submit" variant="primary" disabled={!editable || busy || !ok}>
          {busy ? t('common.saving') : t('common.save')}
        </Button>
      </form>
      {!ok && (
        <p className="small screening-error" role="alert">
          {t('screening.admin.invalid')}
        </p>
      )}
    </Card>
  );
}
