import { describe, expect, it } from 'vitest';
import { sampleBillOfLading, sampleInvoice, samplePackingList, type BillOfLading } from '@doccheck/schemas';
import {
  buildExport, cargowiseXml, chatBody, checkPattern, ConnectorRegistry, eventType, ExportInputError, fromProject44, fromTerminal49, fromVizion, isChatWebhookUrl, isIngestible,
  MockConnector, mockEvents, MockTrackingProvider, normalizeVessel, normalizeVoyage, referenceFor, signPayload, trackingFindings, verifySignature, x12Asn856, x12Ocean310,
  type ContainerEvent, type WebhookEvent,
} from './index';

const bl: BillOfLading = { ...sampleBillOfLading, vessel: 'M/V Example Star', voyage: '012E', shippedOnBoardDate: '2026-10-05' };
const input = { shipment: { id: '0f8b2c1e-1111-4222-8333-944455566677', reference: 'SHP-1001', destination: 'CA' as const, transportMode: 'SEA' as const }, invoice: sampleInvoice, packingList: samplePackingList, billOfLading: bl, createdAt: '2026-10-16T12:30:00Z' };

describe('webhook signatures', () => {
  const body = JSON.stringify({ id: 'evt_1', type: 'ping', data: { message: 'hi' } });

  it('verifies what it signs, with the timestamp inside the signature', () => {
    const header = signPayload('whsec_test', body, 1_800_000_000);
    expect(header).toMatch(/^t=1800000000,v1=[0-9a-f]{64}$/);
    expect(verifySignature('whsec_test', body, header, { now: 1_800_000_100 })).toEqual({ ok: true, timestamp: 1_800_000_000 });
  });

  it('refuses another secret, a changed body, a moved timestamp and an old delivery', () => {
    const header = signPayload('whsec_test', body, 1_800_000_000);
    expect(verifySignature('whsec_other', body, header, { now: 1_800_000_000 })).toEqual({ ok: false, reason: 'mismatch' });
    expect(verifySignature('whsec_test', body.replace('hi', 'ho'), header, { now: 1_800_000_000 })).toEqual({ ok: false, reason: 'mismatch' });
    expect(verifySignature('whsec_test', body, header.replace('t=1800000000', 't=1800000001'), { now: 1_800_000_000 })).toEqual({ ok: false, reason: 'mismatch' });
    expect(verifySignature('whsec_test', body, header, { now: 1_800_000_301 })).toEqual({ ok: false, reason: 'expired' });
    expect(verifySignature('whsec_test', body, undefined)).toEqual({ ok: false, reason: 'malformed' });
    expect(verifySignature('whsec_test', body, 't=abc,v1=zz')).toEqual({ ok: false, reason: 'malformed' });
  });

  it('accepts any of several v1 values (secret rotation)', () => {
    const good = signPayload('whsec_new', body, 1_800_000_000).split('v1=')[1];
    const old = signPayload('whsec_old', body, 1_800_000_000).split('v1=')[1];
    expect(verifySignature('whsec_new', body, `t=1800000000,v1=${old},v1=${good}`, { now: 1_800_000_000 }).ok).toBe(true);
  });
});

describe('chat messages', () => {
  const event: WebhookEvent<'finding.created'> = {
    id: 'evt_2',
    type: 'finding.created',
    createdAt: '2026-10-16T12:00:00Z',
    data: {
      shipment: { id: input.shipment.id, reference: 'SHP-1001 <b>', url: 'https://app.example/#/app/s/x' },
      validationId: 'v1',
      finding: { fingerprint: 'f'.repeat(32), ruleId: 'X2', severity: 'HIGH', message: 'Invoice says 120 packages, BL says 118' },
    },
  };

  it('quotes nothing from the documents unless details are turned on', () => {
    const plain = JSON.stringify(slack(false));
    expect(plain).not.toContain('120 packages');
    expect(plain).toContain('X2');
    expect(plain).toContain('https://app.example/#/app/s/x');
    expect(JSON.stringify(slack(true))).toContain('120 packages');
  });

  it('escapes Slack control characters and builds a Teams Adaptive Card', () => {
    expect(JSON.stringify(slack(false))).toContain('SHP-1001 &lt;b&gt;');
    const teams = chatBody('teams', event, { includeDetails: false }) as { attachments: { contentType: string; content: { actions: { url: string }[] } }[] };
    expect(teams.attachments[0]!.contentType).toBe('application/vnd.microsoft.card.adaptive');
    expect(teams.attachments[0]!.content.actions[0]!.url).toBe('https://app.example/#/app/s/x');
  });

  it('only takes incoming-webhook URLs on Slack and Microsoft hosts, over https', () => {
    expect(isChatWebhookUrl('slack', 'https://hooks.slack.com/services/T0/B0/x')).toBe(true);
    expect(isChatWebhookUrl('slack', 'http://hooks.slack.com/services/T0/B0/x')).toBe(false);
    expect(isChatWebhookUrl('slack', 'https://hooks.slack.com.evil.example/x')).toBe(false);
    expect(isChatWebhookUrl('teams', 'https://contoso.webhook.office.com/webhookb2/x')).toBe(true);
    expect(isChatWebhookUrl('teams', 'https://prod-01.westus.logic.azure.com:443/workflows/x')).toBe(true);
    expect(isChatWebhookUrl('teams', 'https://169.254.169.254/latest')).toBe(false);
  });

  function slack(includeDetails: boolean) {
    return chatBody('slack', event, { includeDetails });
  }
});

describe('folder ingestion grouping', () => {
  it('groups by folder or by the start of the file name', () => {
    expect(referenceFor('SHP-1001/invoice.pdf', 'folder')).toBe('SHP-1001');
    expect(referenceFor('2026/SHP-1001/bl.pdf', 'folder')).toBe('SHP-1001');
    expect(referenceFor('invoice.pdf', 'folder')).toBeNull();
    expect(referenceFor('SHP-1001_invoice.pdf', 'filename')).toBe('SHP-1001');
    expect(referenceFor('in/SHP-1001 BL.pdf', 'filename')).toBe('SHP-1001');
    expect(referenceFor('invoice.pdf', 'filename')).toBeNull();
    expect(referenceFor('PO4411-inv.pdf', 'filename', '^PO(\\d+)-')).toBe('4411');
  });

  it('checks patterns: a capture group, no nested repetition', () => {
    expect(checkPattern('^PO(\\d+)-')).toBeNull();
    expect(checkPattern('^PO\\d+-')).toMatch(/capture group/);
    expect(checkPattern('((a+)+)$')).toMatch(/Nested/);
    expect(checkPattern('(')).toMatch(/Not a valid/);
  });

  it('ingests PDFs only, not hidden or temporary files', () => {
    expect(isIngestible('a/SHP-1_inv.PDF')).toBe(true);
    expect(isIngestible('a/.SHP-1_inv.pdf')).toBe(false);
    expect(isIngestible('a/~SHP-1_inv.pdf')).toBe(false);
    expect(isIngestible('a/SHP-1_inv.pdf.part')).toBe(false);
  });
});

describe('CargoWise Universal Shipment', () => {
  const xml = cargowiseXml(input).body;

  it('writes the route, containers, parties and invoice lines in the eAdapter shape', () => {
    expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\n<UniversalShipment xmlns="http:\/\/www.cargowise.com\/Schemas\/Universal\/2011\/11" version="1.1">/);
    expect(xml).toContain('<WayBillNumber>HBLSZ123456</WayBillNumber>');
    expect(xml).toMatch(/<WayBillType>\s*<Code>HWB<\/Code>/);
    expect(xml).toMatch(/<PortOfLoading>\s*<Code>CNYTN<\/Code>\s*<Name>Yantian<\/Name>/);
    expect(xml).toContain('<ContainerNumber>CSQU3054383</ContainerNumber>');
    expect(xml).toContain('<VesselName>M/V Example Star</VesselName>');
    expect(xml).toContain('<TotalWeight>1250</TotalWeight>');
    expect(xml).toContain('<HarmonisedCode>950300</HarmonisedCode>');
    expect(xml).toContain('<LinePrice>48600.00</LinePrice>');
    expect(xml).toMatch(/<AddressType>ConsigneeDocumentaryAddress<\/AddressType>\s*<CompanyName>Maple Retail Inc.<\/CompanyName>/);
    expect(xml).toMatch(/<FreightPaymentTerm>\s*<Code>CCX<\/Code>/);
  });

  it('escapes text and leaves out what the documents do not say', () => {
    const odd = cargowiseXml({ ...input, invoice: { ...sampleInvoice, lines: [{ ...sampleInvoice.lines[0]!, description: 'Bears & "dolls" <small>' }] } }).body;
    expect(odd).toContain('Bears &amp; &quot;dolls&quot; &lt;small&gt;');
    expect(xml).not.toContain('<BookingConfirmationReference>');
    expect(xml).not.toMatch(/<\w+><\/\w+>/);
  });

  it('needs the invoice or the BL', () => {
    expect(() => cargowiseXml({ shipment: input.shipment, packingList: samplePackingList })).toThrow(ExportInputError);
  });
});

describe('X12', () => {
  const segments = (body: string) => body.trim().split('~\n').map((s) => s.replace(/~$/, ''));

  it('builds an 856 with a valid envelope and counts', () => {
    const file = x12Asn856(input, { senderId: 'ACME', receiverId: 'PARTNER', controlNumber: 42 });
    const s = segments(file.body);
    expect(s[0]).toHaveLength(105);
    expect(s[0]).toMatch(/^ISA\*00\* {10}\*00\* {10}\*ZZ\*ACME {11}\*ZZ\*PARTNER {8}\*261016\*1230\*U\*00401\*000000042\*0\*T\*>$/);
    expect(s[1]).toBe('GS*SH*ACME*PARTNER*20261016*1230*42*X*004010');
    expect(s[2]).toBe('ST*856*0001');
    expect(s).toContain('HL*1**S');
    expect(s).toContain('TD1*CTN*120****G*1250*KG');
    expect(s).toContain('TD3*CN*CSQU*3054383******ML-889120');
    expect(s).toContain('REF*BM*HBLSZ123456');
    expect(s).toContain('LIN*1*SK*TB-200*HC*950300');
    expect(s).toContain('SN1**6000*PC');
    expect(s).toContain('CTT*3');
    const st = s.indexOf('ST*856*0001');
    const se = s.findIndex((x) => x.startsWith('SE*'));
    expect(s[se]).toBe(`SE*${se - st + 1}*0001`);
    expect(s.at(-2)).toBe('GE*1*42');
    expect(s.at(-1)).toBe('IEA*1*000000042');
  });

  it('builds a 310 from the bill of lading and keeps separators out of values', () => {
    const file = x12Ocean310({ ...input, billOfLading: { ...bl, cargoDescription: 'TOYS*~>STUFF' } });
    const s = segments(file.body);
    expect(s).toContain('B3**HBLSZ123456*SHP-1001*CC**20261016*****EXLN');
    expect(s).toContain('V1**M/V Example Star**012E*EXLN');
    expect(s).toContain('R4*L*UN*CNYTN*Yantian');
    expect(s).toContain('L5*1*TOYS STUFF');
    expect(s.find((x) => x.startsWith('N7*'))).toMatch(/^N7\*CSQU\*3054383\*1250\*G/);
    expect(() => x12Ocean310({ shipment: input.shipment, invoice: sampleInvoice })).toThrow(ExportInputError);
  });
});

describe('connectors', () => {
  it('the mock connector takes complete files and rejects broken ones', async () => {
    const mock = new MockConnector();
    const registry = new ConnectorRegistry().register(mock);
    expect(registry.list()).toEqual([{ id: 'mock', name: mock.name, formats: ['cargowise-xml', 'x12-856', 'x12-310'] }]);
    const meta = { shipmentId: input.shipment.id, orgId: 'acct' };
    expect(await registry.get('mock')!.send(buildExport('cargowise-xml', input), meta)).toEqual({ status: 'accepted', reference: 'MOCK-000001' });
    expect(await mock.send(buildExport('x12-856', input), meta)).toEqual({ status: 'accepted', reference: 'MOCK-000002' });
    const broken = { ...buildExport('x12-310', input) };
    broken.body = broken.body.replace(/IEA.*$/s, '');
    expect((await mock.send(broken, meta)).status).toBe('rejected');
    expect(mock.received.map((r) => r.reference)).toEqual(['MOCK-000001', 'MOCK-000002']);
  });
});

describe('container tracking', () => {
  const blDoc = { id: 'doc-bl', data: bl };
  const ev = (e: Partial<ContainerEvent>): ContainerEvent => ({ containerNumber: 'CSQU3054383', type: 'OTHER', at: '2026-10-05T00:00:00Z', actual: true, ...e });

  it('finds nothing when the events agree with the BL', async () => {
    const events = await new MockTrackingProvider(bl, 'consistent').events({ containerNumber: 'CSQU3054383' });
    expect(trackingFindings('s1', blDoc, events, 'mock')).toEqual([]);
  });

  it('finds the vessel, port and gate-in conflicts, citing both sides', () => {
    const findings = trackingFindings('s1', blDoc, mockEvents(bl, 'CSQU3054383', 'conflicting'), 'mock');
    expect(findings.map((f) => f.ruleId)).toEqual(['T1', 'T2', 'T3']);
    expect(findings[0]!.evidence).toEqual([
      { documentId: 'doc-bl', field: 'vessel', value: 'M/V Example Star' },
      { documentId: 'tracking:mock', field: 'containers[0].events.loaded.vessel', value: 'MOCK DIFFERENT VESSEL' },
      { documentId: 'doc-bl', field: 'voyage', value: '012E' },
      { documentId: 'tracking:mock', field: 'containers[0].events.loaded.voyage', value: '999W' },
    ]);
    expect(findings[1]!.evidence[1]).toEqual({ documentId: 'tracking:mock', field: 'containers[0].events.loaded.location.unLocode', value: 'SGSIN' });
    expect(findings[2]!.message).toContain('2026-10-06');
    expect(findings.every((f) => f.severity === 'HIGH' && f.decidedBy === 'RULE' && f.suggestedFix)).toBe(true);
  });

  it('ignores estimates, spelling differences, other containers and missing data', () => {
    const events = [
      ev({ type: 'GATE_IN', at: '2026-10-09T08:00:00+08:00', actual: false }),
      ev({ type: 'LOADED', vessel: 'EXAMPLE-STAR', voyage: '12 E', location: { name: 'YANTIAN' } }),
      ev({ containerNumber: 'MSCU1234565', type: 'GATE_IN', at: '2026-10-09T08:00:00Z' }),
    ];
    expect(trackingFindings('s1', blDoc, events, 'vizion')).toEqual([]);
    expect(trackingFindings('s1', { id: 'b', data: { ...bl, shippedOnBoardDate: undefined, vessel: undefined, voyage: undefined } }, mockEvents(bl, 'CSQU3054383', 'conflicting'), 'mock').map((f) => f.ruleId)).toEqual(['T2']);
  });

  it('uses the terminal calendar date for the gate-in', () => {
    // 23:30 in Shenzhen on the 5th is the 5th there, whatever the UTC date.
    expect(trackingFindings('s1', blDoc, [ev({ type: 'GATE_IN', at: '2026-10-05T23:30:00+08:00' })], 'mock')).toEqual([]);
  });

  it('normalizes vessels, voyages and event codes', () => {
    expect(normalizeVessel('M/V Ever Given')).toBe(normalizeVessel('EVER-GIVEN'));
    expect(normalizeVoyage('012E')).toBe(normalizeVoyage('12 e'));
    expect(['GTIN', 'container.transport.full_in', 'Gate in full', 'LOAD', 'vessel_loaded', 'DEPA', 'Vessel Departure', 'DISC', 'GTOT', 'whatever'].map(eventType)).toEqual([
      'GATE_IN', 'GATE_IN', 'GATE_IN', 'LOADED', 'LOADED', 'DEPARTED', 'DEPARTED', 'DISCHARGED', 'GATE_OUT', 'OTHER',
    ]);
  });

  it('reads project44, Vizion and Terminal49 shapes', () => {
    const p44 = fromProject44(
      {
        stops: [{ id: 's1', location: { name: 'Yantian', identifiers: [{ type: 'UN_LOCODE', value: 'CNYTN' }] } }],
        vehicles: [{ id: 'v1', name: 'EXAMPLE STAR' }],
        transportationEquipment: [{ id: 'e1', identifiers: [{ type: 'CONTAINER_ID', value: 'CSQU3054383' }] }, { id: 'e2', identifiers: [{ type: 'CONTAINER_ID', value: 'OTHER0000000' }] }],
        events: [
          { type: 'GATE_IN_FULL', dateTime: '2026-10-03T10:00:00+08:00', stopId: 's1', transportationEquipmentId: 'e1' },
          { type: 'LOADED_ON_VESSEL', dateTime: '2026-10-05T10:00:00+08:00', stopId: 's1', vehicleId: 'v1', voyage: '012E', transportationEquipmentId: 'e1' },
          { type: 'GATE_IN_FULL', dateTime: '2026-10-09T10:00:00+08:00', stopId: 's1', transportationEquipmentId: 'e2' },
          { type: 'ARRIVAL_AT_STOP', dateTime: '2026-10-25T10:00:00-07:00', dateTimeType: 'ESTIMATED' },
        ],
      },
      'CSQU3054383',
    );
    expect(p44.map((e) => [e.type, e.actual, e.location?.unLocode, e.vessel])).toEqual([
      ['GATE_IN', true, 'CNYTN', undefined],
      ['LOADED', true, 'CNYTN', 'EXAMPLE STAR'],
      ['ARRIVED', false, undefined, undefined],
    ]);

    const vizion = fromVizion({ payload: { events: [{ description: 'Loaded on vessel', timestamp: '2026-10-05T10:00:00Z', location: { name: 'Yantian', unlocode: 'CNYTN' }, vessel: 'EXAMPLE STAR', voyage: '012E' }] } }, 'CSQU3054383');
    expect(vizion[0]).toMatchObject({ type: 'LOADED', vessel: 'EXAMPLE STAR', voyage: '012E', location: { unLocode: 'CNYTN' } });

    const t49 = fromTerminal49(
      {
        data: [{ id: '1', type: 'transport_event', attributes: { event: 'container.transport.vessel_loaded', timestamp: '2026-10-05T10:00:00Z', voyage_number: '012E', location_locode: 'CNYTN' }, relationships: { vessel: { data: { id: 'v', type: 'vessel' } } } }],
        included: [{ id: 'v', type: 'vessel', attributes: { name: 'EXAMPLE STAR' } }],
      },
      'CSQU3054383',
    );
    expect(t49[0]).toMatchObject({ type: 'LOADED', vessel: 'EXAMPLE STAR', voyage: '012E', location: { unLocode: 'CNYTN' } });
    expect(trackingFindings('s1', blDoc, [...p44, ...vizion, ...t49], 'project44')).toEqual([]);
  });
});
