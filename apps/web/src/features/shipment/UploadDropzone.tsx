import { UploadIcon } from '@radix-ui/react-icons';
import { useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { cx } from '../../lib/cx';

export interface UploadDropzoneProps {
  uploading: boolean;
  /** US shipments also take the ISF filing PDF. */
  acceptsIsf: boolean;
  onFiles: (files: File[]) => void;
}

export function UploadDropzone({ uploading, acceptsIsf, onFiles }: UploadDropzoneProps) {
  const input = useRef<HTMLInputElement>(null);
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
      <span>{uploading ? 'Uploading…' : `Drop PDFs here or click to choose: invoice, packing list, bill of lading${acceptsIsf ? ', ISF' : ''}`}</span>
    </div>
  );
}
