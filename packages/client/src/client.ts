import type { ApiErrorBody, Destination, DocumentDetail, ExportFormat, SendResult, Shipment, ShipmentList, TransportMode, Validation } from './types';

export interface ClientOptions {
  /** The DocCheck server, e.g. "https://doccheck.example.com". */
  baseUrl: string;
  /** An API key from Integrations → API keys ("dck_..."). */
  apiKey: string;
  /** Retries of a request answered 429 (rate limit), after the Retry-After the server gives. Default 2. */
  maxRetries?: number;
  fetch?: typeof fetch;
}

/** An answer that is not 2xx, with the API's error body. */
export class DocCheckApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody | undefined,
  ) {
    super(body?.message ?? `DocCheck API answered ${status}`);
    this.name = 'DocCheckApiError';
  }
}

export interface FileInput {
  name: string;
  /** PDF bytes. */
  data: Uint8Array | ArrayBuffer | Blob;
}

/** Writes accept an idempotency key: send the same one again after a timeout, and the work is not done twice. */
export interface WriteOptions {
  idempotencyKey?: string;
}

/**
 * Client for the DocCheck public API v1.
 *
 *   const dc = new DocCheckClient({ baseUrl, apiKey });
 *   const s = await dc.createShipment({ reference: 'PO-4411', destination: 'CA' }, { idempotencyKey: 'po-4411' });
 *   await dc.uploadDocuments(s.id, [{ name: 'invoice.pdf', data: bytes }]);
 *   await dc.waitForExtraction(s.id);
 *   const { findings } = await dc.validate(s.id, { wait: true });
 */
export class DocCheckClient {
  private readonly base: string;
  private readonly fetch: typeof fetch;
  private readonly maxRetries: number;

  constructor(private readonly opts: ClientOptions) {
    this.base = opts.baseUrl.replace(/\/+$/, '');
    this.fetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.maxRetries = opts.maxRetries ?? 2;
  }

  /** Last rate-limit headers seen: requests left this minute and seconds until the window resets. */
  rateLimit?: { limit: number; remaining: number; resetSeconds: number };

  private async request(method: string, path: string, init: { body?: BodyInit; json?: unknown; headers?: Record<string, string> } = {}): Promise<Response> {
    const headers: Record<string, string> = { authorization: `Bearer ${this.opts.apiKey}`, accept: 'application/json', ...init.headers };
    let body = init.body;
    if (init.json !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(init.json);
    }
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetch(`${this.base}/api/v1${path}`, { method, headers, body });
      const limit = res.headers.get('ratelimit-limit');
      if (limit) this.rateLimit = { limit: Number(limit), remaining: Number(res.headers.get('ratelimit-remaining')), resetSeconds: Number(res.headers.get('ratelimit-reset')) };
      if (res.status === 429 && attempt < this.maxRetries) {
        const wait = Number(res.headers.get('retry-after') ?? '1');
        await new Promise((r) => setTimeout(r, Math.min(60, Math.max(1, wait)) * 1000));
        continue;
      }
      if (!res.ok) {
        const text = await res.text();
        let parsed: ApiErrorBody | undefined;
        try {
          parsed = JSON.parse(text) as ApiErrorBody;
        } catch {
          parsed = undefined;
        }
        throw new DocCheckApiError(res.status, parsed);
      }
      return res;
    }
  }

  private async json<T>(method: string, path: string, init?: Parameters<DocCheckClient['request']>[2]): Promise<T> {
    return (await this.request(method, path, init)).json() as Promise<T>;
  }

  private static idem(o?: WriteOptions): Record<string, string> {
    return o?.idempotencyKey ? { 'idempotency-key': o.idempotencyKey } : {};
  }

  listShipments(query: { status?: 'all' | 'open' | 'attention' | 'done'; destination?: Destination; q?: string; limit?: number; offset?: number } = {}) {
    const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString();
    return this.json<ShipmentList>('GET', `/shipments${qs ? `?${qs}` : ''}`);
  }

  createShipment(body: { reference?: string; destination?: Destination; transportMode?: TransportMode }, opts?: WriteOptions) {
    return this.json<Shipment>('POST', '/shipments', { json: body, headers: DocCheckClient.idem(opts) });
  }

  getShipment(id: string) {
    return this.json<Shipment>('GET', `/shipments/${encodeURIComponent(id)}`);
  }

  /** Up to 10 PDFs of 20 MB; they are extracted in the background. */
  uploadDocuments(id: string, files: FileInput[], opts?: WriteOptions) {
    const form = new FormData();
    for (const f of files) {
      const blob = f.data instanceof Blob ? f.data : new Blob([f.data instanceof Uint8Array ? new Uint8Array(f.data) : f.data], { type: 'application/pdf' });
      form.append('files', blob, f.name);
    }
    return this.json<{ documents: Shipment['documents'] }>('POST', `/shipments/${encodeURIComponent(id)}/documents`, { body: form, headers: DocCheckClient.idem(opts) });
  }

  getDocument(id: string, documentId: string) {
    return this.json<DocumentDetail>('GET', `/shipments/${encodeURIComponent(id)}/documents/${encodeURIComponent(documentId)}`);
  }

  /** Polls until no document is queued or being extracted. */
  async waitForExtraction(id: string, { timeoutMs = 10 * 60_000, intervalMs = 2000 } = {}): Promise<Shipment> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const s = await this.getShipment(id);
      if (!s.documents.some((d) => d.status === 'QUEUED' || d.status === 'EXTRACTING')) return s;
      if (Date.now() > deadline) throw new Error(`Documents of shipment ${id} were still being extracted after ${Math.round(timeoutMs / 1000)} s`);
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  /** With wait: the validation when it is done. Without: starts it (validation.completed follows on webhooks). */
  validate(id: string, opts: { wait: true; agent?: boolean }): Promise<Validation>;
  validate(id: string, opts?: { wait?: false; agent?: boolean }): Promise<{ shipmentId: string; status: 'VALIDATING' }>;
  validate(id: string, opts: { wait?: boolean; agent?: boolean } = {}) {
    const qs = new URLSearchParams({ ...(opts.wait ? { wait: 'true' } : {}), ...(opts.agent === undefined ? {} : { agent: String(opts.agent) }) }).toString();
    return this.json('POST', `/shipments/${encodeURIComponent(id)}/validate${qs ? `?${qs}` : ''}`);
  }

  getFindings(id: string) {
    return this.json<Validation>('GET', `/shipments/${encodeURIComponent(id)}/findings`);
  }

  /** The export file's text (XML or X12). */
  async exportShipment(id: string, format: ExportFormat): Promise<string> {
    return (await this.request('GET', `/shipments/${encodeURIComponent(id)}/exports/${format}`)).text();
  }

  sendExport(id: string, format: ExportFormat, connector: string) {
    return this.json<SendResult>('POST', `/shipments/${encodeURIComponent(id)}/exports/${format}/send`, { json: { connector } });
  }
}
