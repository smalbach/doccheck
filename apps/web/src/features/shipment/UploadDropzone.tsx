import { UploadIcon } from '@radix-ui/react-icons';
import { useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { useI18n } from '../../i18n/useI18n';
import { cx } from '../../lib/cx';

export interface UploadDropzoneProps {
  uploading: boolean;
  /** US shipments also take the ISF filing PDF. */
  acceptsIsf: boolean;
  onFiles: (files: File[]) => void;
}

export function UploadDropzone({ uploading, acceptsIsf, onFiles }: UploadDropzoneProps) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const label = acceptsIsf ? t('shipment.dropzoneIsf') : t('shipment.dropzone');
  const [over, setOver] = useState(false);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    onFiles([...e.dataTransfer.files]);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      input.current?.click();
    }
  };

  return (
    <div
      className={cx('dropzone', over && 'dropzone-over')}
      role="button"
      tabIndex={0}
      aria-busy={uploading}
      aria-label={label}
      onClick={() => input.current?.click()}
      onKeyDown={onKeyDown}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <input
        ref={input}
        type="file"
        accept="application/pdf"
        multiple
        hidden
        onChange={(e) => {
          onFiles([...(e.target.files ?? [])]);
          e.target.value = '';
        }}
      />
      <UploadIcon aria-hidden />
      <span aria-live="polite">{uploading ? t('shipment.uploading') : label}</span>
    </div>
  );
}
