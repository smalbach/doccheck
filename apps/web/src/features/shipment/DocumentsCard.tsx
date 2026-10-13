import { useState } from 'react';
import type { Shipment, ShipmentDocument, Validation } from '../../api/types';
import { Card } from '../../components/ui/Card';
import { isPendingDocument } from '../../lib/isPendingDocument';
import type { ViewerTarget } from '../pdf/types';
import { DocumentList } from './DocumentList';
import { IsfCard } from './IsfCard';
import { SkippedRules } from './SkippedRules';
import type { ShipmentBusy } from './useShipment';
import { UploadDropzone } from './UploadDropzone';
import { ValidateBar } from './ValidateBar';

export interface DocumentsCardProps {
  shipment: Shipment;
  validation?: Validation;
  documents: ReadonlyMap<string, ShipmentDocument>;
  readOnly: boolean;
  busy?: ShipmentBusy;
  extracting: boolean;
  onUpload: (files: File[]) => void;
  onValidate: (useAgent: boolean) => void;
  onOpen: (target: ViewerTarget) => void;
  onShowData: (doc: ShipmentDocument) => void;
  onError: (message: string) => void;
}

/** Documents of the shipment, the upload area, the Validate action and the ISF on file. */
export function DocumentsCard({ shipment, validation, documents, readOnly, busy, extracting, onUpload, onValidate, onOpen, onShowData, onError }: DocumentsCardProps) {
  const [useAgent, setUseAgent] = useState(true);
  const extracted = shipment.documents.filter((d) => d.status === 'EXTRACTED').length;
  // Reload the ISF when an ISF PDF arrives or finishes extracting.
  const isfVersion = shipment.documents
    .filter((d) => d.detectedType === 'ISF' || isPendingDocument(d))
    .map((d) => `${d.id}:${d.status}`)
    .join(',');

  return (
    <Card title="Documents">
      {!readOnly && <UploadDropzone uploading={busy === 'upload'} acceptsIsf={shipment.destination === 'US'} onFiles={onUpload} />}
      <DocumentList documents={shipment.documents} onOpen={(doc) => onOpen({ doc })} onShowData={onShowData} />
      <ValidateBar
        useAgent={useAgent}
        onUseAgentChange={setUseAgent}
        validating={busy === 'validate'}
        disabled={busy !== undefined || extracting || extracted === 0}
        onValidate={() => onValidate(useAgent)}
      />
      {shipment.destination === 'US' && (
        <IsfCard
          shipmentId={shipment.id}
          version={isfVersion}
          readOnly={readOnly}
          onError={onError}
          onOpen={(documentId) => {
            const doc = documents.get(documentId);
            if (doc) onOpen({ doc });
          }}
        />
      )}
      {validation && <SkippedRules skipped={validation.skipped} />}
    </Card>
  );
}
