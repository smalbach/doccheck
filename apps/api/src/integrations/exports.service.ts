import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { buildExport, ConnectorRegistry, ExportInputError, MockConnector, type ExportFile, type ExportFormat, type ExportInput } from '@doccheck/integrations';
import type { AirWaybill, BillOfLading, CommercialInvoice, PackingList } from '@doccheck/schemas';
import { ShipmentsRepository } from '../shipments/shipments.repository';

const SLOTS = { invoice: 'invoice', packingList: 'packingList', billOfLading: 'billOfLading', airWaybill: 'airWaybill' } as const;

/**
 * Exports of a validated shipment (CargoWise Universal Shipment XML, X12 856 and 310), built from the
 * documents its latest validation read, and connectors that send them on. Only the mock connector is
 * registered: live CargoWise or VAN connections need partner credentials (see ShipmentConnector).
 */
@Injectable()
export class ExportsService {
  readonly connectors = new ConnectorRegistry();

  constructor(private readonly repo: ShipmentsRepository) {
    if (process.env.EXPORT_MOCK_CONNECTOR !== 'false') this.connectors.register(new MockConnector());
  }

  /** The documents the latest validation used. 409 before the shipment was validated. */
  async input(shipmentId: string): Promise<ExportInput> {
    const shipment = await this.repo.findShipment(shipmentId);
    if (!shipment) throw new NotFoundException(`Shipment ${shipmentId} not found`);
    const validation = await this.repo.latestValidation(shipmentId);
    if (!validation) throw new ConflictException('Validate the shipment first: exports are built from the validated documents');
    const extractions = new Map((await this.repo.listExtractions(shipmentId)).map((e) => [e.documentId, e.data]));
    const pick = <T>(slot: keyof typeof SLOTS) => {
      const id = validation.inputs[slot];
      return id ? (extractions.get(id) as T | undefined) ?? undefined : undefined;
    };
    return {
      shipment: { id: shipment.id, reference: shipment.reference, destination: shipment.destination, transportMode: shipment.transportMode },
      invoice: pick<CommercialInvoice>('invoice'),
      packingList: pick<PackingList>('packingList'),
      billOfLading: pick<BillOfLading>('billOfLading'),
      airWaybill: pick<AirWaybill>('airWaybill'),
    };
  }

  async build(shipmentId: string, format: ExportFormat): Promise<ExportFile> {
    const input = await this.input(shipmentId);
    try {
      return buildExport(format, input, { senderId: process.env.X12_SENDER_ID, receiverId: process.env.X12_RECEIVER_ID, usage: process.env.X12_USAGE === 'P' ? 'P' : 'T' });
    } catch (err) {
      if (err instanceof ExportInputError) throw new ConflictException(err.message);
      throw err;
    }
  }

  async send(shipmentId: string, orgId: string, format: ExportFormat, connectorId: string) {
    const connector = this.connectors.get(connectorId);
    if (!connector) throw new BadRequestException(`No connector "${connectorId}". Available: ${this.connectors.list().map((c) => c.id).join(', ') || 'none'}`);
    if (!connector.formats.includes(format)) throw new BadRequestException(`Connector ${connectorId} does not take ${format}`);
    const file = await this.build(shipmentId, format);
    const result = await connector.send(file, { shipmentId, orgId });
    return { connector: connector.id, format, ...result };
  }
}
