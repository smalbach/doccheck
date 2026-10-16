import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { reviewApi, type ReviewDocument, type ReviewField } from '../../api/review';
import { BackLink } from '../../components/layout/BackLink';
import { LoadingCard } from '../../components/layout/LoadingCard';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { PageHeader } from '../../components/ui/PageHeader';
import { DOCUMENT_TYPE_KEY } from '../../constants/documentTypes';
import { useDemo } from '../../hooks/useDemo';
import { useReviewShortcuts } from '../../hooks/useReviewShortcuts';
import { useI18n } from '../../i18n/useI18n';
import { errorMessage } from '../../lib/errorMessage';
import { navigate } from '../../lib/navigate';
import { reviewFieldLabel } from '../../lib/reviewFieldLabel';
import { ReviewFieldList } from './ReviewFieldList';
import { ReviewFieldPanel } from './ReviewFieldPanel';
import { ReviewPdfPane } from './ReviewPdfPane';

const pending = (f: ReviewField) => f.low && !f.review;

/** The first value still to check after `from` (wrapping), or `from` when none is left. */
function nextPending(fields: ReviewField[], from: number): number {
  for (let step = 1; step <= fields.length; step++) {
    const i = (from + step) % fields.length;
    if (pending(fields[i]!)) return i;
  }
  return from;
}

/** One document of the queue: the PDF beside its values, checked one after another from the keyboard. */
export function ReviewDocumentPage({ id }: { id: string }) {
  const { t } = useI18n();
  const demo = useDemo();
  const [doc, setDoc] = useState<ReviewDocument>();
  const [error, setError] = useState<string>();
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ tone: 'ok' | 'error'; text: string }>();
  const [editRequest, setEditRequest] = useState(0);

  useEffect(() => {
    let active = true;
    reviewApi.document(id).then(
      (d) => {
        if (!active) return;
        setDoc(d);
        setSelected(Math.max(0, d.fields.findIndex(pending)));
      },
      (e: unknown) => active && setError(errorMessage(e)),
    );
    return () => {
      active = false;
    };
  }, [id]);

  const field = doc?.fields[selected];
  const label = field && doc ? reviewFieldLabel(field.path, doc.documentType, t) : '';
  const select = (i: number) => {
    if (!doc?.fields.length) return;
    const n = doc.fields.length;
    setSelected(((i % n) + n) % n);
    // Keep the chosen value in view and announced (the list item is a button).
    requestAnimationFrame(() => document.getElementById(`review-field-${((i % n) + n) % n}`)?.focus());
  };
  const run = async (work: () => Promise<ReviewDocument>, done: string) => {
    if (!doc || !field) return;
    setBusy(true);
    try {
      const next = await work();
      setDoc(next);
      const at = next.fields.findIndex((f) => f.path === field.path);
      setSelected(nextPending(next.fields, at < 0 ? 0 : at));
      setStatus({ tone: 'ok', text: done });
    } catch (e) {
      setStatus({ tone: 'error', text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  const accept = () => field && doc && !busy && void run(() => reviewApi.accept(doc.documentId, [field.path]), t('reviewQueue.savedAccept', { field: label }));
  const save = (text: string) => {
    if (!field || !doc) return;
    const value = text === '' ? null : typeof field.value === 'number' && /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : text;
    void run(async () => {
      await api.correctData(doc.shipmentId, doc.documentId, [{ path: field.path, value }]);
      return reviewApi.document(doc.documentId);
    }, t('reviewQueue.savedEdit', { field: label }));
  };
  const nextDocument = () => navigate(doc?.next ? `/app/review/${doc.next}` : '/app/review');

  useReviewShortcuts(
    {
      next: () => select(selected + 1),
      previous: () => select(selected - 1),
      accept: () => !demo && accept(),
      edit: () => !demo && setEditRequest((n) => n + 1),
      nextDocument,
    },
    !!doc,
  );

  if (!doc) return <LoadingCard error={error} />;
  const left = doc.fields.filter(pending).length;
  return (
    <div className="page">
      <PageHeader
        eyebrow={<BackLink href="#/app/review" label={t('reviewQueue.back')} />}
        title={t('reviewQueue.documentTitle', { name: doc.fileName })}
        description={`${t(DOCUMENT_TYPE_KEY[doc.documentType])} · ${doc.shipmentReference ?? t('reviewQueue.noReference')}`}
        actions={
          <>
            <Button asChild>
              <a href={`#/app/s/${doc.shipmentId}`}>{t('reviewQueue.openShipment')}</a>
            </Button>
            <Button variant="primary" onClick={nextDocument} aria-keyshortcuts="N">
              {doc.next ? t('reviewQueue.nextDocument') : t('reviewQueue.back')}
            </Button>
          </>
        }
      />
      <p className="visually-hidden" role="status">
        {status?.tone === 'ok' ? status.text : ''}
      </p>
      {status?.tone === 'error' && <Banner tone="error">{status.text}</Banner>}
      {left === 0 && <Banner tone="ok">{doc.next ? t('reviewQueue.allChecked') : `${t('reviewQueue.allChecked')} ${t('reviewQueue.noNext')}`}</Banner>}
      <div className="review-layout">
        <ReviewPdfPane shipmentId={doc.shipmentId} documentId={doc.documentId} fileName={doc.fileName} field={field} />
        <div className="review-side">
          <Card title={t('reviewQueue.fieldsTitle')}>
            {field ? (
              <ReviewFieldPanel field={field} documentType={doc.documentType} busy={busy} editable={!demo} editRequest={editRequest} onAccept={accept} onSave={save} />
            ) : (
              <p className="muted">{t('reviewQueue.nothingSelected')}</p>
            )}
            <ReviewFieldList fields={doc.fields} documentType={doc.documentType} selected={selected} onSelect={select} />
          </Card>
          <p className="muted small review-shortcuts">
            <strong>{t('reviewQueue.shortcutsTitle')}:</strong> {t('reviewQueue.shortcuts')}
          </p>
        </div>
      </div>
    </div>
  );
}
