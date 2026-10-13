import { lazy, Suspense, useState } from 'react';
import type { ShipmentDocument } from '../../api/types';
import { LoadingCard } from '../../components/layout/LoadingCard';
import { Banner } from '../../components/ui/Banner';
import { Sheet } from '../../components/ui/Sheet';
import { useDemo } from '../../hooks/useDemo';
import { useI18n } from '../../i18n/useI18n';
import { textBeingWritten } from '../../lib/liveOutput';
import { evidencePointer } from '../../lib/findingReview';
import { showFinding } from '../../lib/showFinding';
import { liveValidationRun } from '../../lib/validationCaption';
import { DocumentDataSheet } from '../document-data/DocumentDataSheet';
import { ComposeDialog } from '../mail/ComposeDialog';
import { ThreadsCard } from '../mail/ThreadsCard';
import type { ViewerTarget } from '../pdf/types';
import { DocumentsCard } from './DocumentsCard';
import { EditShipmentDialog } from './EditShipmentDialog';
import { ExportMenu } from './ExportMenu';
import { FindingsCard } from './FindingsCard';
import { ProgressAnnouncer } from './ProgressAnnouncer';
import { ShipmentHeader } from './ShipmentHeader';
import { useShipment } from './useShipment';
import { useValidationHistory } from './useValidationHistory';
import { ValidationHistory } from './ValidationHistory';
import { ValidationNotice } from './ValidationNotice';
import { ValidationProgress } from './ValidationProgress';

// pdf.js is large: load it only when a document is opened.
const PdfViewerSheet = lazy(() => import('../pdf/PdfViewerSheet').then((m) => ({ default: m.PdfViewerSheet })));

export function ShipmentPage({ id }: { id: string }) {
  const { t } = useI18n();
  const demo = useDemo();
  const { reviewFindings, reviewing, shipment, validation: latest, validationLoaded, rules, documents, error, setError, busy, extracting, refresh, upload, validate, update, remove, progress, lastLive } = useShipment(id);
  const history = useValidationHistory(id, latest?.id);
  const [viewer, setViewer] = useState<ViewerTarget>();
  const [dataDoc, setDataDoc] = useState<{ doc: ShipmentDocument; focus?: string }>();

  if (!shipment) return <LoadingCard error={error} />;
  // A past run picked in the history replaces the latest one in Findings and in the export.
  const validation = history.past ?? latest;
  // A running validation (or one saved but not fetched yet) shows its findings as they come.
  const live = liveValidationRun(progress.validation, latest?.id, validationLoaded);

  return (
    <div className="page shipment">
      <ShipmentHeader
        shipment={shipment}
        canDelete={!demo}
        extracting={extracting}
        onDelete={() => void remove()}
        actions={
          <>
            {!demo && <EditShipmentDialog shipment={shipment} extracting={extracting} onSave={update} />}
            {validation && <ExportMenu shipment={shipment} validation={validation} />}
          </>
        }
      />
      {error && <Banner tone="error">{error}</Banner>}
      <ProgressAnnouncer event={lastLive} progress={progress} documents={documents} />

      <div className="shipment-columns">
        <DocumentsCard
          shipment={shipment}
          validation={validation}
          documents={documents}
          readOnly={demo}
          busy={busy}
          extracting={extracting}
          runs={progress.documents}
          outputs={progress.outputs}
          onUpload={(files) => void upload(files)}
          onValidate={(useAgent) => void validate(useAgent)}
          onOpen={setViewer}
          onShowData={(doc) => setDataDoc({ doc })}
          onError={setError}
        />
        <FindingsCard
          validation={validation}
          rules={rules}
          documents={documents}
          onOpen={setViewer}
          live={live}
          run={progress.validation}
          review={
            !demo && !history.past && latest
              ? {
                  busy: reviewing,
                  shipmentId: shipment.id,
                  reference: shipment.reference ?? shipment.id.slice(0, 8),
                  onReview: reviewFindings,
                  onCorrect: (doc, field) => setDataDoc({ doc, focus: evidencePointer(field) }),
                }
              : undefined
          }
          progress={
            <ValidationProgress run={progress.validation} validating={busy === 'validate'} shownId={validation?.id} rules={rules} onShowFinding={(findingId) => void showFinding(findingId)} />
          }
          notice={<ValidationNotice shipment={shipment} validation={validation} past={!!history.past} onShowLatest={history.showLatest} />}
        />
      </div>
      <ThreadsCard shipmentId={id} actions={!demo && <ComposeDialog mode="message" shipmentId={id} reference={shipment.reference ?? ''} />} />
      <ValidationHistory
        runs={history.runs}
        shownId={validation?.id}
        latestId={latest?.id}
        loadingId={history.loadingId}
        error={history.error}
        onShow={(validationId) => void history.show(validationId)}
      />

      {dataDoc && (
        <DocumentDataSheet
          shipmentId={id}
          doc={dataDoc.doc}
          focus={dataDoc.focus}
          readOnly={demo}
          onClose={() => setDataDoc(undefined)}
          onReextracted={() => {
            setDataDoc(undefined);
            void refresh();
          }}
          onCorrected={() => void refresh()}
        />
      )}
      {viewer && (
        <Suspense
          fallback={
            <Sheet title={t('viewer.loading')} onClose={() => setViewer(undefined)}>
              <p className="muted sheet-body" role="status">
                {t('viewer.loading')}
              </p>
            </Sheet>
          }
        >
          <PdfViewerSheet
            shipmentId={id}
            target={viewer}
            onClose={() => setViewer(undefined)}
            liveText={textBeingWritten(progress.documents[viewer.doc.id], progress.outputs?.[viewer.doc.id])}
          />
        </Suspense>
      )}
    </div>
  );
}
