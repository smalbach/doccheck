import { CameraIcon } from '@radix-ui/react-icons';
import { Dialog } from 'radix-ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { useI18n } from '../../i18n/useI18n';
import { errorMessage } from '../../lib/errorMessage';
import { CapturedPages } from './CapturedPages';
import { CaptureReview } from './CaptureReview';
import { candidateFromFile, makeCandidate, nextPaint, pagesToPdf, release, type Candidate, type ScanImage } from './frames';
import { PhotoInput } from './PhotoInput';
import { useCamera } from './useCamera';

export interface ScanSessionProps {
  onDone: (pdf: File) => void;
}

/** The inside of the scan dialog: live camera (or photos), review of each capture, the pages so far, Make PDF. */
export function ScanSession({ onDone }: ScanSessionProps) {
  const { t } = useI18n();
  const { stream, problem } = useCamera();
  const [pages, setPages] = useState<ScanImage[]>([]);
  const [candidate, setCandidate] = useState<{ value: Candidate; fromPhoto: boolean }>();
  const [queue, setQueue] = useState<File[]>([]);
  const [working, setWorking] = useState<'detecting' | 'pdf'>();
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string>();
  const video = useRef<HTMLVideoElement>(null);
  const captureButton = useRef<HTMLButtonElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const makeButton = useRef<HTMLButtonElement>(null);

  // Every preview URL made in this session, freed when the dialog closes.
  const images = useRef(new Set<ScanImage>());
  useEffect(() => {
    const all = images.current;
    return () => all.forEach(release);
  }, []);
  const track = (c: Candidate) => {
    images.current.add(c.photo);
    if (c.crop) images.current.add(c.crop);
    return c;
  };
  const drop = (image: ScanImage | undefined) => {
    if (!image) return;
    release(image);
    images.current.delete(image);
  };

  const attachVideo = useCallback(
    (el: HTMLVideoElement | null) => {
      video.current = el;
      if (el && stream && el.srcObject !== stream) {
        el.srcObject = stream;
        void el.play().catch(() => undefined);
      }
    },
    [stream],
  );
  useEffect(() => {
    if (stream) setStatus(t('capture.ready'));
  }, [stream, t]);

  const focusNext = () => setTimeout(() => (captureButton.current ?? photoInput.current)?.focus());

  const review = async (load: () => Promise<Candidate>, fromPhoto: boolean) => {
    setWorking('detecting');
    setError(undefined);
    setStatus(t('capture.detecting'));
    try {
      await nextPaint();
      const value = track(await load());
      setCandidate({ value, fromPhoto });
      setStatus(value.crop ? t('capture.edgesFound') : t('capture.noEdges'));
      return true;
    } catch {
      setError(t('capture.photoFailed'));
      return false;
    } finally {
      setWorking(undefined);
    }
  };

  const nextPhoto = async (files: File[]) => {
    let rest = files;
    while (rest.length) {
      const [first, ...others] = rest;
      rest = others;
      setQueue(others);
      if (await review(() => candidateFromFile(first!), true)) return;
    }
    focusNext();
  };

  const capture = () => {
    const el = video.current;
    if (!el || !el.videoWidth) return;
    void review(() => makeCandidate(el, el.videoWidth, el.videoHeight), false);
  };

  const finishReview = (keep?: ScanImage) => {
    if (!candidate) return;
    const { photo, crop } = candidate.value;
    [photo, crop].forEach((image) => image !== keep && drop(image));
    setCandidate(undefined);
    if (keep) {
      setPages((all) => [...all, keep]);
      setStatus(t('capture.captured', { number: pages.length + 1 }));
    }
    if (queue.length) void nextPhoto(queue);
    else focusNext();
  };

  const remove = (index: number) => {
    drop(pages[index]);
    setPages((all) => all.filter((_, i) => i !== index));
    setStatus(t('capture.removed', { number: index + 1 }));
    setTimeout(() => (pages.length > 1 ? makeButton.current : (captureButton.current ?? photoInput.current))?.focus());
  };

  const makePdf = async () => {
    setWorking('pdf');
    setError(undefined);
    setStatus(t('capture.making'));
    try {
      onDone(await pagesToPdf(pages));
    } catch (e) {
      setError(t('capture.pdfFailed', { message: errorMessage(e) }));
      setWorking(undefined);
    }
  };

  const busy = working !== undefined;
  return (
    <>
      <p role="status" className="visually-hidden">
        {status}
      </p>
      {problem && <Banner tone="info">{t(`capture.${problem}`)}</Banner>}
      {error && <Banner tone="error">{error}</Banner>}
      {candidate && (
        <CaptureReview
          candidate={candidate.value}
          number={pages.length + 1}
          fromPhoto={candidate.fromPhoto}
          onKeep={(use) => finishReview(use === 'crop' ? candidate.value.crop : candidate.value.photo)}
          onRetake={() => finishReview()}
        />
      )}
      {!problem && (
        <div className="capture-live" hidden={candidate !== undefined}>
          <video ref={attachVideo} className="capture-video" aria-label={t('capture.videoLabel')} autoPlay muted playsInline />
          {!stream && <p className="capture-overlay-text">{t('capture.starting')}</p>}
        </div>
      )}
      {!candidate && (
        <div className="capture-tools">
          {!problem && (
            <Button ref={captureButton} variant="primary" disabled={!stream || busy} onClick={capture}>
              <CameraIcon aria-hidden /> {working === 'detecting' ? t('capture.detecting') : t('capture.capture')}
            </Button>
          )}
          <PhotoInput inputRef={photoInput} primary={problem !== undefined} disabled={busy} onFiles={(files) => void nextPhoto(files)} />
        </div>
      )}
      <CapturedPages pages={pages} disabled={busy} onRemove={remove} />
      <div className="dialog-actions">
        <Dialog.Close asChild>
          <Button>{t('common.cancel')}</Button>
        </Dialog.Close>
        <Button ref={makeButton} variant="primary" disabled={pages.length === 0 || busy || candidate !== undefined} onClick={() => void makePdf()}>
          {working === 'pdf' ? t('capture.making') : t('capture.makePdf')}
        </Button>
      </div>
    </>
  );
}
