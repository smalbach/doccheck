import { ImageIcon } from '@radix-ui/react-icons';
import type { ChangeEvent, Ref } from 'react';
import { useI18n } from '../../i18n/useI18n';
import { cx } from '../../lib/cx';

export interface PhotoInputProps {
  disabled: boolean;
  onFiles: (files: File[]) => void;
  inputRef?: Ref<HTMLInputElement>;
  primary?: boolean;
}

/** Photos from the phone's camera app or the gallery: the way in when the browser cannot open the camera itself. */
export function PhotoInput({ disabled, onFiles, inputRef, primary }: PhotoInputProps) {
  const { t } = useI18n();
  const change = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    // Cleared so choosing the same photo again still fires a change.
    e.target.value = '';
    if (files.length) onFiles(files);
  };
  return (
    <label className={cx('btn', primary && 'btn-primary', 'capture-file', disabled && 'is-disabled')}>
      <input ref={inputRef} type="file" accept="image/*" capture="environment" multiple className="visually-hidden" disabled={disabled} onChange={change} />
      <ImageIcon aria-hidden /> {t('capture.choosePhotos')}
    </label>
  );
}
