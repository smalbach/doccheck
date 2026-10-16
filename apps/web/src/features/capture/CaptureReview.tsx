import { useEffect, useRef } from 'react';
import { Button } from '../../components/ui/Button';
import { useI18n } from '../../i18n/useI18n';
import type { Candidate } from './frames';

export interface CaptureReviewProps {
  candidate: Candidate;
  /** The number the page will get. */
  number: number;
  /** From a chosen photo rather than the live camera: "Discard" instead of "Retake". */
  fromPhoto: boolean;
  onKeep: (use: 'crop' | 'full') => void;
  onRetake: () => void;
}

/** The captured photo with the page edges found drawn over it, the straightened crop, and the choice between them. */
export function CaptureReview({ candidate, number, fromPhoto, onKeep, onRetake }: CaptureReviewProps) {
  const { t } = useI18n();
  const first = useRef<HTMLButtonElement>(null);
  const { photo, crop, quad } = candidate;
  useEffect(() => first.current?.focus(), [candidate]);

  return (
    <section className="capture-review" aria-labelledby="capture-review-title">
      <h3 id="capture-review-title" className="capture-subtitle">
        {t('capture.reviewTitle', { number })}
      </h3>
      <p className="muted">{crop ? t('capture.edgesFound') : t('capture.noEdges')}</p>
      <div className="capture-compare">
        <figure className="capture-figure">
          <div className="capture-frame">
            <img src={photo.url} alt={t('capture.photoAlt', { number })} />
            {crop && (
              <svg className="capture-quad" viewBox={`0 0 ${photo.width} ${photo.height}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
                <polygon points={quad.map((p) => `${p.x},${p.y}`).join(' ')} />
              </svg>
            )}
          </div>
          <figcaption>{t('capture.photo')}</figcaption>
        </figure>
        {crop && (
          <figure className="capture-figure">
            <img src={crop.url} alt={t('capture.croppedAlt', { number })} />
            <figcaption>{t('capture.cropped')}</figcaption>
          </figure>
        )}
      </div>
      <div className="capture-tools">
        {crop && (
          <Button ref={first} variant="primary" onClick={() => onKeep('crop')}>
            {t('capture.keepCrop')}
          </Button>
        )}
        <Button ref={crop ? undefined : first} variant={crop ? 'default' : 'primary'} onClick={() => onKeep('full')}>
          {t('capture.useFull')}
        </Button>
        <Button onClick={onRetake}>{fromPhoto ? t('capture.discard') : t('capture.retake')}</Button>
      </div>
    </section>
  );
}
