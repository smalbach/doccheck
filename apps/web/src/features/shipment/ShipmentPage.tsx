import { lazy, Suspense, useState } from 'react';
import type { ShipmentDocument } from '../../api/types';
import { LoadingCard } from '../../components/layout/LoadingCard';
import { Banner } from '../../components/ui/Banner';
import { Sheet } from '../../components/ui/Sheet';
import { useDemo } from '../../hooks/useDemo';
import { useI18n } from '../../i18n/useI18n';
import { DocumentDataSheet } from '../document-data/DocumentDataSheet';
import type { ViewerTarget } from '../pdf/types';
import { DocumentsCard } from './DocumentsCard';
import { EditShipmentDialog } from './EditShipmentDialog';
import { ExportMenu } from './ExportMenu';
import { FindingsCard } from './FindingsCard';
import { ShipmentHeader } from './ShipmentHeader';
import { useShipment } from './useShipment';
import { useValidationHistory } from './useValidationHistory';
import { ValidationHistory } from './ValidationHistory';
import { ValidationNotice } from './ValidationNotice';

// pdf.js is large: load it only when a document is opened.
const PdfViewerSheet = lazy(() => import('../pdf/PdfViewerSheet').then((m) => ({ default: m.PdfViewerSheet })));

export function ShipmentPage({ id }: { id: string }) {
  const { t } = useI18n();
  const demo = useDemo();
  const { shipment, validation: latest, rules, documents, error, setError, busy, extracting, refresh, upload, validate, update, remove } = useShipment(id);
  const history = useValidationHistory(id, latest?.id);
  const [viewer, setViewer] = useState<ViewerTarget>();
  const [dataDoc, setDataDoc] = useState<ShipmentDocument>();

  if (!shipment) return <LoadingCard error={error} />;
  // A past run picked in the history replaces the latest one in Findings and in the export.
  const validation = history.past ?? latest;

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

      <div className="shipment-columns">
        <DocumentsCard
          shipment={shipment}
          validation={validation}
          documents={documents}
          readOnly={demo}
          busy={busy}
          extracting={extracting}
          onUpload={(files) => void upload(files)}
          onValidate={(useAgent) => void validate(useAgent)}
          onOpen={setViewer}
          onShowData={setDataDoc}
          onError={setError}
        />
        <FindingsCard
          validation={validation}
          rules={rules}
          documents={documents}
          onOpen={setViewer}
          notice={<ValidationNotice shipment={shipment} validation={validation} past={!!history.past} onShowLatest={history.showLatest} />}
        />
      </div>
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
          doc={dataDoc}
          readOnly={demo}
          onClose={() => setDataDoc(undefined)}
          onReextracted={() => {
            setDataDoc(undefined);
            void refresh();
          }}
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
          <PdfViewerSheet shipmentId={id} target={viewer} onClose={() => setViewer(undefined)} />
        </Suspense>
      )}
    </div>
  );
}
