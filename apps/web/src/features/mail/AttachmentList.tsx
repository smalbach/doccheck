import { FileIcon } from '@radix-ui/react-icons';
import { useState } from 'react';
import { api } from '../../api/client';
import type { MailAttachment } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { useI18n } from '../../i18n/useI18n';
import { errorMessage } from '../../lib/errorMessage';

export interface AttachmentListProps {
  attachments: readonly MailAttachment[];
  /** The conversation's shipment: PDFs can be added to it as documents. */
  shipmentId?: string;
  readOnly: boolean;
  onAdded: (file: string) => void;
  onError: (message: string) => void;
}

const size = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

/** Files received with a message: opened in a new tab, and PDFs added to the shipment in one click. */
export function AttachmentList({ attachments, shipmentId, readOnly, onAdded, onError }: AttachmentListProps) {
  const { t } = useI18n();
  const [busy, setBusy] = useState<string>();
  const [added, setAdded] = useState<Record<string, string>>({});
  if (attachments.length === 0) return null;
  const add = async (a: MailAttachment) => {
    setBusy(a.id);
    try {
      const { documentId } = await api.importAttachment(a.id);
      setAdded((m) => ({ ...m, [a.id]: documentId }));
      onAdded(a.filename);
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(undefined);
    }
  };
  return (
    <ul className="attachment-list" aria-label={t('mail.attachments')}>
      {attachments.map((a) => {
        const inShipment = a.documentId ?? added[a.id];
        return (
          <li key={a.id}>
            <FileIcon aria-hidden />
            <a href={api.attachmentUrl(a.id)} target="_blank" rel="noopener noreferrer">
              {a.filename}
            </a>
            <span className="muted small">{size(a.size)}</span>
            {shipmentId && a.contentType === 'application/pdf' &&
              (inShipment ? (
                <a className="small" href={`#/app/s/${shipmentId}`}>
                  {t('mail.added')}
                </a>
              ) : (
                !readOnly && (
                  <Button size="sm" disabled={busy === a.id} onClick={() => void add(a)}>
                    {t('mail.addToShipment')}
                  </Button>
                )
              ))}
          </li>
        );
      })}
    </ul>
  );
}
