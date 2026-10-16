import { DownloadIcon } from '@radix-ui/react-icons';
import { DropdownMenu } from 'radix-ui';
import type { ShipmentDocument } from '../../api/types';
import { useI18n } from '../../i18n/useI18n';
import { errorMessage } from '../../lib/errorMessage';
import { exportUrl, type ExportFormat } from './integrationsApi';

/** Downloads an export through fetch, so a refusal (409) is told instead of opening a JSON page. */
async function download(shipmentId: string, format: ExportFormat) {
  const res = await fetch(exportUrl(shipmentId, format), { credentials: 'same-origin' });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { message?: string }).message ?? `${res.status}`);
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? `shipment.${format}`;
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * CargoWise XML and X12 items of the shipment's Export menu. A format that needs a document the
 * shipment has not got extracted (a 310 is an ocean bill of lading) is not offered.
 */
export function ExportFormatItems({ shipmentId, documents, onError }: { shipmentId: string; documents: ShipmentDocument[]; onError?: (message: string) => void }) {
  const { t } = useI18n();
  const has = (type: ShipmentDocument['detectedType']) => documents.some((d) => d.detectedType === type && d.status === 'EXTRACTED');
  const bl = has('BILL_OF_LADING');
  // A 310 is an ocean bill of lading: an air shipment exports its air waybill as CargoWise XML or an 856.
  const formats: ExportFormat[] = bl ? ['cargowise-xml', 'x12-856', 'x12-310'] : has('AIR_WAYBILL') || has('COMMERCIAL_INVOICE') ? ['cargowise-xml', 'x12-856'] : [];
  if (!formats.length) return null;
  return (
    <>
      <DropdownMenu.Separator className="menu-separator" />
      {formats.map((f) => (
        <DropdownMenu.Item key={f} className="menu-item" onSelect={() => void download(shipmentId, f).catch((err: unknown) => (onError ?? window.alert)(errorMessage(err)))}>
          <DownloadIcon aria-hidden /> {t(`integrations.exports.formats.${f}`)}
        </DropdownMenu.Item>
      ))}
    </>
  );
}
