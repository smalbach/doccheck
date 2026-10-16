import { UploadIcon } from '@radix-ui/react-icons';
import { useId, useState, type FormEvent } from 'react';
import { portalApi, type PortalView } from '../../api/portal';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { useI18n } from '../../i18n/useI18n';
import { cx } from '../../lib/cx';
import { errorMessage } from '../../lib/errorMessage';
import { isUploadableFile, UPLOAD_ACCEPT } from '../../lib/isUploadableFile';

export interface PortalUploadFormProps {
  token: string;
  importer: string;
  limits: PortalView['limits'];
  onUploaded: (view: PortalView) => void;
}

/** Corrected or draft documents (PDF, photos, spreadsheets), checked here first (type, size, count) and again by the server. */
export function PortalUploadForm({ token, importer, limits, onUploaded }: PortalUploadFormProps) {
  const { t } = useI18n();
  const inputId = useId();
  const [files, setFiles] = useState<File[]>([]);
  const [note, setNote] = useState('');
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const mb = (bytes: number) => Math.round(bytes / 1024 / 1024);

  const choose = (picked: File[]) => {
    setError(undefined);
    const notPdf = picked.find((f) => !isUploadableFile(f));
    if (notPdf) return setError(t('portal.notPdf', { file: notPdf.name }));
    const big = picked.find((f) => f.size > limits.maxFileBytes);
    if (big) return setError(t('portal.tooLarge', { file: big.name, size: mb(limits.maxFileBytes) }));
    const next = [...files, ...picked].slice(0, limits.maxFiles + 1);
    if (next.length > limits.maxFiles) return setError(t('portal.tooMany', { count: limits.maxFiles }));
    setFiles(next);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (files.length === 0) return;
    setBusy(true);
    setError(undefined);
    try {
      onUploaded(await portalApi.upload(token, files, note.trim() || undefined));
      setFiles([]);
      setNote('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={t('portal.uploadTitle')}>
      <form className="portal-upload" onSubmit={(e) => void submit(e)} aria-busy={busy}>
        <p className="muted small" id={`${inputId}-hint`}>
          {t('portal.uploadHint', { size: mb(limits.maxFileBytes), files: limits.maxFiles })}
        </p>
        {/* The input stays focusable (hidden from view): the dropzone is its label and shows its focus. */}
        <input
          id={inputId}
          className="portal-file-input visually-hidden"
          type="file"
          accept={UPLOAD_ACCEPT}
          multiple
          aria-describedby={`${inputId}-hint`}
          onChange={(e) => {
            choose([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
        <label
          htmlFor={inputId}
          className={cx('dropzone', over && 'dropzone-over')}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            choose([...e.dataTransfer.files]);
          }}
        >
          <UploadIcon aria-hidden />
          <span>{t('portal.dropzone')}</span>
        </label>
        {files.length > 0 && (
          <div className="portal-chosen">
            <span className="small" aria-live="polite">
              {t('portal.chosen', { count: files.length, names: files.map((f) => f.name).join(', ') })}
            </span>
            <Button size="sm" variant="ghost" onClick={() => setFiles([])}>
              {t('portal.clear')}
            </Button>
          </div>
        )}
        <Field label={t('portal.note', { importer })}>
          {(id) => <textarea id={id} className="input textarea" rows={3} maxLength={5000} value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
        {error && <Banner tone="error">{error}</Banner>}
        <div>
          <Button type="submit" variant="primary" disabled={busy || files.length === 0}>
            {busy ? t('portal.sending') : t('portal.send')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
