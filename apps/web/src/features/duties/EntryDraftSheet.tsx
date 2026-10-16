import { DownloadIcon, FileTextIcon } from '@radix-ui/react-icons';
import type { ReactNode } from 'react';
import type { Cbp7501Draft, CbsaCadDraft, EntryDraft } from '../../api/dutyTypes';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Sheet } from '../../components/ui/Sheet';
import { useI18n } from '../../i18n/useI18n';
import { downloadJson } from '../../lib/downloadJson';

const PRINT_CLASS = 'printing-entry';

/** Prints only the draft: the page behind the sheet is hidden while the print dialog is open. */
function printDraft() {
  document.body.classList.add(PRINT_CLASS);
  const done = () => {
    document.body.classList.remove(PRINT_CLASS);
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 0);
}

/** The prefilled CBP 7501 or CBSA CAD, clearly a draft: shown, downloaded as JSON or printed. Never transmitted. */
export function EntryDraftSheet({ entry, onClose }: { entry: EntryDraft; onClose: () => void }) {
  const { t } = useI18n();
  const us = entry.form === 'CBP Form 7501';
  return (
    <Sheet
      title={us ? t('duties.entry.titleUS') : t('duties.entry.titleCA')}
      onClose={onClose}
      actions={
        <>
          <Button size="sm" onClick={() => downloadJson(`${entry.reference ?? entry.shipmentId.slice(0, 8)}-${us ? '7501' : 'cad'}-draft.json`, entry)}>
            <DownloadIcon aria-hidden /> {t('duties.entry.download')}
          </Button>
          <Button size="sm" onClick={printDraft}>
            <FileTextIcon aria-hidden /> {t('duties.entry.print')}
          </Button>
        </>
      }
    >
      <div className="sheet-body entry-draft">
        <p className="entry-watermark" aria-hidden>
          {entry.status}
        </p>
        <Banner tone="warning">{t('duties.entry.banner')}</Banner>
        {us ? <Us7501 entry={entry as Cbp7501Draft} /> : <CaCad entry={entry as CbsaCadDraft} />}
        <h3>{t('duties.entry.notes')}</h3>
        <ul className="small" lang="en">
          {entry.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </div>
    </Sheet>
  );
}

function Value({ v }: { v?: string | { name: string; address: string } }) {
  const { t } = useI18n();
  if (v === undefined || v === '') return <span className="muted">{t('duties.entry.blank')}</span>;
  if (typeof v === 'string') return <>{v}</>;
  return (
    <>
      {v.name}
      <br />
      <span className="small">{v.address}</span>
    </>
  );
}

function Header({ rows }: { rows: [string, ReactNode][] }) {
  const { t } = useI18n();
  return (
    <>
      <h3>{t('duties.entry.header')}</h3>
      <dl className="entry-header">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

function Table({ caption, head, rows }: { caption: string; head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="table-wrap" tabIndex={0} role="region" aria-label={caption}>
      <table className="table table-compact entry-table">
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Totals({ rows }: { rows: [string, string][] }) {
  const { t } = useI18n();
  return (
    <>
      <h3>{t('duties.entry.totals')}</h3>
      <dl className="entry-header">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              <strong>{value}</strong>
            </dd>
          </div>
        ))}
      </dl>
    </>
  );
}

function Us7501({ entry }: { entry: Cbp7501Draft }) {
  const { t } = useI18n();
  const h = entry.header;
  const k = (key: string) => t(`duties.entry.us.${key}` as Parameters<typeof t>[0]);
  return (
    <>
      <Header
        rows={(['filerCodeEntryNumber', 'entryType', 'entryDate', 'importingCarrier', 'modeOfTransport', 'countryOfOrigin', 'blOrAwbNumber', 'manufacturerId', 'exportingCountry', 'exportDate', 'foreignPortOfLading', 'usPortOfUnlading', 'referenceNumber', 'ultimateConsignee', 'importerOfRecord'] as const).map((f) => [k(f), <Value v={h[f]} />] as [string, ReactNode])}
      />
      <h3>{t('duties.entry.lines')}</h3>
      <Table
        caption={t('duties.entry.lines')}
        head={['lineNo', 'description', 'htsus', 'netQuantity', 'enteredValue', 'charges', 'relationship', 'htsusRate', 'duty'].map(k)}
        rows={entry.lines.map((l) => [
          l.lineNo,
          <>
            {l.description}
            {l.manufacturerId && <div className="small muted">MID {l.manufacturerId} · {l.countryOfOrigin}</div>}
          </>,
          <>
            <code>{l.htsus}</code>
            {l.spi && <div className="small">SPI {l.spi}</div>}
            {l.chapter99.map((c) => (
              <div key={c.number} className="small">
                <code>{c.number}</code> {c.rate} = {c.amount}
              </div>
            ))}
            {l.adCvdCase && <div className="small">AD/CVD {l.adCvdCase}</div>}
          </>,
          l.netQuantity,
          l.enteredValue,
          l.charges,
          <Value v={l.relationship} />,
          <Value v={l.htsusRate} />,
          <Value v={l.duty} />,
        ])}
      />
      <Totals
        rows={[
          [k('totalDuty'), entry.totals.duty],
          [k('totalTax'), entry.totals.tax],
          [`${k('totalOther')}${entry.totals.other.length ? ` (${entry.totals.other.map((o) => `${o.classCode} ${o.amount}`).join(', ')})` : ''}`, entry.totals.otherTotal],
          [k('total'), entry.totals.total],
        ]}
      />
    </>
  );
}

function CaCad({ entry }: { entry: CbsaCadDraft }) {
  const { t } = useI18n();
  const h = entry.header;
  const k = (key: string) => t(`duties.entry.ca.${key}` as Parameters<typeof t>[0]);
  return (
    <>
      <Header
        rows={(['transactionNumber', 'importer', 'importerBusinessNumber', 'vendor', 'countryOfExport', 'placeOfExport', 'directShipmentDate', 'modeOfTransport', 'portOfEntry', 'cargoControlNumber', 'currency', 'exchangeRate', 'province'] as const).map((f) => [k(f), <Value v={h[f]} />] as [string, ReactNode])}
      />
      <h3>{t('duties.entry.lines')}</h3>
      <Table
        caption={t('duties.entry.lines')}
        head={['lineNo', 'description', 'countryOfOrigin', 'tariffTreatment', 'classification', 'quantity', 'vfdCode', 'valueForCurrencyConversion', 'valueForDuty', 'customsDutyRate', 'customsDuty', 'surtax', 'valueForTax', 'gst'].map(k)}
        rows={entry.lines.map((l) => [
          l.lineNo,
          l.description,
          l.countryOfOrigin,
          <>
            {l.tariffTreatment}
            {l.tariffTreatmentCode && <span className="small muted"> ({l.tariffTreatmentCode})</span>}
          </>,
          <>
            <code>{l.classification}</code>
            {l.simaFlag && <div className="small">SIMA {l.simaFlag}</div>}
          </>,
          `${l.quantity} ${l.unitOfMeasure}`,
          <Value v={l.vfdCode} />,
          l.valueForCurrencyConversion,
          l.valueForDuty,
          <Value v={l.customsDutyRate} />,
          <Value v={l.customsDuty} />,
          l.surtax,
          l.valueForTax,
          l.gst,
        ])}
      />
      <Totals
        rows={[
          [k('totalDuty'), entry.totals.customsDuty],
          [k('totalSurtax'), entry.totals.surtax],
          [k('totalExcise'), entry.totals.exciseTax],
          [k('totalGst'), entry.totals.gst],
          [k('total'), entry.totals.total],
          [k('selfAssessedHst'), entry.totals.selfAssessedHst],
        ]}
      />
    </>
  );
}
