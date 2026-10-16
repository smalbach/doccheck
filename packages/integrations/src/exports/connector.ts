import { cargowiseXml } from './cargowise';
import { ExportInputError, type ExportFile, type ExportFormat, type ExportInput } from './input';
import { x12Asn856, x12Ocean310, type X12Options } from './x12';

/** Builds an export file in the given format. */
export function buildExport(format: ExportFormat, input: ExportInput, x12: X12Options = {}): ExportFile {
  switch (format) {
    case 'cargowise-xml':
      return cargowiseXml(input);
    case 'x12-856':
      return x12Asn856(input, x12);
    case 'x12-310':
      return x12Ocean310(input, x12);
    default:
      throw new ExportInputError(`Unknown export format ${String(format)}`);
  }
}

export interface ConnectorResult {
  status: 'accepted' | 'rejected';
  /** The receiving system's id for what was sent, when it gives one. */
  reference?: string;
  message?: string;
}

/**
 * Sends an export to another system (a CargoWise eAdapter endpoint, an EDI VAN, an SFTP drop).
 * Live connectors need partner credentials and are not part of DocCheck; implement this interface
 * and register the connector to add one. `formats` lists what it takes.
 */
export interface ShipmentConnector {
  readonly id: string;
  readonly name: string;
  readonly formats: readonly ExportFormat[];
  send(file: ExportFile, meta: { shipmentId: string; orgId: string }): Promise<ConnectorResult>;
}

/**
 * A connector that keeps what it is sent in memory: for development, demos and tests. It checks the
 * file the way a receiving system would at the door (format taken, XML or X12 envelope present) and
 * rejects what fails.
 */
export class MockConnector implements ShipmentConnector {
  readonly id = 'mock';
  readonly name = 'Mock (keeps files in memory)';
  readonly formats: readonly ExportFormat[] = ['cargowise-xml', 'x12-856', 'x12-310'];
  readonly received: { file: ExportFile; shipmentId: string; orgId: string; reference: string }[] = [];
  private seq = 0;

  async send(file: ExportFile, meta: { shipmentId: string; orgId: string }): Promise<ConnectorResult> {
    if (!this.formats.includes(file.format)) return { status: 'rejected', message: `Format ${file.format} is not taken` };
    const ok = file.format === 'cargowise-xml' ? /<UniversalShipment[\s>]/.test(file.body) : /^ISA\*/.test(file.body) && /IEA\*1\*\d{9}~\s*$/.test(file.body);
    if (!ok) return { status: 'rejected', message: 'The file is not a complete document of its format' };
    const reference = `MOCK-${String(++this.seq).padStart(6, '0')}`;
    this.received.push({ file, ...meta, reference });
    return { status: 'accepted', reference };
  }
}

/** Connectors by id. The API registers the mock one; others are added the same way. */
export class ConnectorRegistry {
  private readonly byId = new Map<string, ShipmentConnector>();
  register(c: ShipmentConnector) {
    this.byId.set(c.id, c);
    return this;
  }
  get(id: string) {
    return this.byId.get(id);
  }
  list() {
    return [...this.byId.values()].map((c) => ({ id: c.id, name: c.name, formats: [...c.formats] }));
  }
}
