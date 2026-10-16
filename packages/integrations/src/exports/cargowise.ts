import type { Party } from '@doccheck/schemas';
import { ExportInputError, fileSafe, type ExportFile, type ExportInput } from './input';
import { code, e, render, t, type Node } from './xml';

export const UNIVERSAL_NAMESPACE = 'http://www.cargowise.com/Schemas/Universal/2011/11';

/**
 * A CargoWise One Universal Shipment (the XML eAdapter takes in) for a forwarding shipment, built
 * from the extracted documents: bill of lading for route, vessel and containers; commercial invoice
 * for the parties, terms and lines; packing list for packages and weights where the BL has none.
 *
 * An air shipment (air waybill, no bill of lading) is written with the AWB as the waybill, its
 * pieces, weights, airports (by name: CargoWise port codes are UN/LOCODEs, the AWB prints IATA codes)
 * and first flight, and no containers.
 *
 * Values are written as the documents state them after normalization (decimal strings, ISO dates,
 * kilograms). Element names follow the Universal Shipment schema; check the mapping with your
 * CargoWise administrator before importing, since each installation can require more codes.
 */
export function cargowiseXml(input: ExportInput): ExportFile {
  const { invoice: inv, packingList: pl, billOfLading: bl, airWaybill: awb, shipment } = input;
  if (!inv && !bl && !awb) throw new ExportInputError('A CargoWise shipment needs at least the commercial invoice, the bill of lading or the air waybill');
  const mode = shipment.transportMode ?? inv?.transport?.mode ?? (bl ? 'SEA' : awb ? 'AIR' : undefined);
  const packs = bl?.totalPackages ?? awb?.pieces ?? pl?.totals.packageCount ?? inv?.packageCount;
  const weight = bl?.totalGrossWeight.kg ?? awb?.grossWeight.kg ?? pl?.totals.grossWeight?.kg ?? inv?.grossWeight?.kg;
  // Air: the AWB stands where the BL would; airports go by name.
  const waybill = bl ? { number: bl.blNumber, type: bl.blType?.issuer === 'HBL' ? 'HWB' : 'MWB' } : awb ? { number: awb.awbNumber, type: awb.issuer === 'HAWB' ? 'HWB' : 'MWB' } : undefined;
  const packType = pl?.packages.every((p) => p.type === pl.packages[0]!.type) ? pl.packages[0]!.type : undefined;

  const doc: Node = {
    name: 'UniversalShipment',
    attrs: { xmlns: UNIVERSAL_NAMESPACE, version: '1.1' },
    children: [
      e('Shipment', [
        e('DataContext', [e('DataTargetCollection', [e('DataTarget', [t('Type', 'ForwardingShipment')])]), t('Company', undefined)]),
        code('ContainerMode', bl ? (bl.containers.length ? 'FCL' : 'LCL') : awb ? 'LSE' : undefined),
        t('DocumentedWeight', weight),
        t('GoodsDescription', bl?.cargoDescription ?? awb?.natureOfGoods ?? inv?.lines[0]?.description),
        code('PortOfLoading', bl?.portOfLoading.unLocode ?? (awb ? undefined : inv?.transport?.placeOfShipment?.unLocode), [t('Name', bl?.portOfLoading.name ?? awb?.airportOfDeparture.name)]),
        code('PortOfDischarge', bl?.portOfDischarge.unLocode ?? (awb ? undefined : inv?.portOfEntry?.unLocode), [t('Name', bl?.portOfDischarge.name ?? awb?.airportOfDestination.name)]),
        code('PortOfOrigin', bl?.placeOfReceipt?.unLocode),
        code('PortOfDestination', bl?.placeOfDelivery?.unLocode),
        code('ShipmentIncoTerm', inv?.incoterm?.code),
        t('ShipmentIncoTermLocation', inv?.incoterm?.place),
        code('FreightPaymentTerm', freight(bl?.freightTerms ?? awb?.freightTerms)),
        t('TotalNoOfPacks', packs),
        code('TotalNoOfPacksPackageType', packType),
        t('TotalWeight', weight),
        code('TotalWeightUnit', weight ? 'KG' : undefined),
        t('TotalVolume', pl?.totals.volumeM3 ?? awb?.volumeM3),
        code('TotalVolumeUnit', pl?.totals.volumeM3 ?? awb?.volumeM3 ? 'M3' : undefined),
        t('ChargeableWeight', awb?.chargeableWeight?.kg),
        code('TransportMode', mode),
        t('VesselName', bl?.vessel),
        t('VoyageFlightNo', bl?.voyage ?? awb?.flights?.[0]?.flight),
        t('WayBillNumber', waybill?.number),
        code('WayBillType', waybill?.type),
        t('MasterBill', awb?.masterAwbNumber),
        t('BookingConfirmationReference', bl?.bookingNumber),
        e('CarrierDetails', bl?.carrier ? [t('Name', bl.carrier.name), t('SCAC', bl.carrier.scac)] : awb?.carrier ? [t('Name', awb.carrier.name), t('IATAPrefix', awb.carrier.iataPrefix)] : []),
        e('DateCollection', [date('OnBoard', bl?.shippedOnBoardDate ?? awb?.flights?.[0]?.date), date('BillIssued', bl?.dateOfIssue ?? awb?.executedOn), date('InvoiceDate', inv?.invoiceDate)]),
        e(
          'ContainerCollection',
          (bl?.containers ?? []).map((c) =>
            e('Container', [t('ContainerNumber', c.number), t('Seal', c.seal), code('ContainerType', c.type), t('GrossWeight', c.grossWeight?.kg), t('NumberOfPackages', c.packages), t('VolumeCapacity', c.volumeM3)]),
          ),
        ),
        e('AdditionalReferenceCollection', [
          ...(inv?.poNumber ? [reference('PON', inv.poNumber)] : []),
          ...(shipment.reference ? [reference('OTH', shipment.reference)] : []),
          ...(bl?.references ?? awb?.references ?? []).map((r) => reference('OTH', r)),
        ]),
        e('OrganizationAddressCollection', [
          org('ConsignorDocumentaryAddress', bl?.shipper ?? awb?.shipper ?? inv?.seller),
          org('ConsigneeDocumentaryAddress', bl?.consignee ?? awb?.consignee ?? inv?.consignee ?? inv?.buyer),
          org('NotifyParty', bl?.notifyParty ?? awb?.notifyParty),
          org('SendersLocalClient', inv?.seller),
          org('ImporterDocumentaryAddress', inv?.buyer),
        ]),
        inv
          ? e('CommercialInfo', [
              e('CommercialInvoiceCollection', [
                e('CommercialInvoice', [
                  t('InvoiceNumber', inv.invoiceNumber),
                  t('InvoiceDate', inv.invoiceDate),
                  t('InvoiceAmount', inv.invoiceTotal.amount),
                  code('InvoiceCurrency', inv.invoiceTotal.currency),
                  code('IncoTerm', inv.incoterm?.code),
                  t('NoOfPacks', inv.packageCount),
                  t('NetWeight', inv.netWeight?.kg),
                  t('GrossWeight', inv.grossWeight?.kg),
                  e(
                    'CommercialInvoiceLineCollection',
                    inv.lines.map((l) =>
                      e('CommercialInvoiceLine', [
                        t('LineNo', l.lineNo),
                        t('PartNo', l.sku),
                        t('Description', l.description),
                        t('InvoiceQuantity', l.quantity.value),
                        code('InvoiceQuantityUnit', l.quantity.unit),
                        t('UnitPrice', l.unitPrice.amount),
                        t('LinePrice', l.lineTotal.amount),
                        code('CountryOfOrigin', l.countryOfOrigin),
                        t('HarmonisedCode', l.hsCode?.replace(/\./g, '')),
                      ]),
                    ),
                  ),
                ]),
              ]),
            ])
          : null,
      ])!,
    ],
  };
  const name = fileSafe(shipment.reference || bl?.blNumber || awb?.awbNumber || inv?.invoiceNumber || shipment.id);
  return { format: 'cargowise-xml', fileName: `${name}.cargowise.xml`, contentType: 'application/xml', body: `<?xml version="1.0" encoding="UTF-8"?>\n${render(doc)}\n` };
}

const freight = (terms: 'PREPAID' | 'COLLECT' | undefined) => (terms === 'PREPAID' ? 'PPD' : terms === 'COLLECT' ? 'CCX' : undefined);
const date = (type: string, value: string | undefined) => e('Date', value ? [code('Type', type), t('IsEstimate', 'false'), t('Value', `${value}T00:00:00`)] : []);
const reference = (type: string, value: string) => e('AdditionalReference', [code('Type', type), t('ReferenceNumber', value)]);

function org(type: string, p: Party | undefined): Node | null {
  if (!p) return null;
  const [a1, a2] = p.address.lines;
  return e('OrganizationAddress', [
    t('AddressType', type),
    t('CompanyName', p.name),
    t('Address1', a1),
    t('Address2', a2),
    t('City', p.address.city),
    t('State', p.address.region),
    t('Postcode', p.address.postalCode),
    code('Country', p.address.country),
    t('Contact', p.contact?.name),
    t('Email', p.contact?.email),
    t('Phone', p.contact?.phone),
    e('RegistrationNumberCollection', p.taxId ? [e('RegistrationNumber', [code('Type', 'LSC'), t('Value', p.taxId)])] : []),
  ]);
}
