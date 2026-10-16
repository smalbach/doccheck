import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ALL_RULES,
  compactRuleConfig,
  DEFAULT_PARAMS,
  OCEAN_CARRIER_SCACS,
  productKey,
  PROFILES,
  RuleConfigSchema,
  type AccountHistory,
  type PricePoint,
  type RuleConfig,
  type RuleParams,
  type ShipmentContext,
} from '@doccheck/rules';
import { parsePurchaseOrdersCsv, PurchaseOrdersInput, type PurchaseOrderInput } from './purchase-orders';
import { RuleSettingsRepository } from './rule-settings.repository';

/** What a validation run applied, stored with it (validations.rule_config) so the run can be explained and replayed. */
export interface AppliedRuleConfig {
  scope: 'default' | 'user';
  /** The account's changes to the defaults, as stored. */
  config: RuleConfig;
  /** Every tolerance in effect, defaults included. */
  params: RuleParams;
  /** The run date rules compare "today" with (X16). */
  asOf: string;
  /** What account history the rules compared with (X17, X23, X24). */
  account: { priorInvoices: number; pricePoints: number; purchaseOrder?: string; purchaseOrders: number };
}

const todayUtc = () => new Date().toISOString().slice(0, 10);

@Injectable()
export class RuleSettingsService {
  constructor(private readonly repo: RuleSettingsRepository) {}

  /** The account's rule settings with the catalog the settings page edits them against. */
  async settings(userId: string) {
    const stored = await this.repo.get('user', userId);
    return {
      scope: 'user' as const,
      config: stored?.config ?? {},
      ...(stored?.updatedAt ? { updatedAt: stored.updatedAt } : {}),
      ...(stored?.updatedBy ? { updatedBy: stored.updatedBy } : {}),
      defaults: DEFAULT_PARAMS,
      bundledScacs: Object.keys(OCEAN_CARRIER_SCACS),
      rules: ALL_RULES.map((r) => ({
        ...r.definition,
        destinations: (Object.keys(PROFILES) as (keyof typeof PROFILES)[]).filter((d) => PROFILES[d].rules.includes(r.definition.id)),
      })),
    };
  }

  async save(userId: string, body: unknown) {
    const parsed = RuleConfigSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException({ message: 'Invalid rule settings', issues: parsed.error.issues });
    const config = compactRuleConfig(parsed.data as RuleConfig);
    if (Object.keys(config).length === 0) await this.repo.remove('user', userId);
    else await this.repo.save('user', userId, config, userId);
    return this.settings(userId);
  }

  async reset(userId: string) {
    await this.repo.remove('user', userId);
    return this.settings(userId);
  }

  /**
   * The config, account history and run date for validating a shipment, and the record of them to
   * store with the run. A shipment without an owner (from before accounts) runs with the defaults.
   * Organization settings will slot in here, under the user's.
   */
  async forValidation(ctx: ShipmentContext): Promise<{ config: RuleConfig; account: AccountHistory; asOf: string; applied: AppliedRuleConfig }> {
    const asOf = todayUtc();
    const owner = await this.repo.shipmentOwner(ctx.shipmentId);
    const stored = owner ? await this.repo.get('user', owner) : null;
    const config = stored?.config ?? {};
    const account: AccountHistory = {};
    if (owner && ctx.invoice) {
      const inv = ctx.invoice.data;
      const [invoices, prices, poCount, po] = await Promise.all([
        this.repo.invoicesNumbered(owner, ctx.shipmentId, inv.invoiceNumber),
        this.repo.pastPrices(
          owner,
          ctx.shipmentId,
          inv.lines.flatMap((l) => (l.sku?.trim() ? [l.sku] : [])),
          inv.lines.flatMap((l) => (l.sku?.trim() ? [] : [l.description])),
        ),
        this.repo.purchaseOrderCount(owner),
        inv.poNumber ? this.repo.purchaseOrderByNumber(owner, inv.poNumber) : Promise.resolve(null),
      ]);
      account.invoices = invoices;
      account.prices = {};
      for (const p of prices) {
        const key = productKey({ sku: p.sku, description: p.description ?? '' });
        if (!key) continue;
        const point: PricePoint = { shipmentId: p.shipmentId, documentId: p.documentId, line: p.idx - 1, unitPrice: p.unitPrice, currency: p.currency, ...(p.unit ? { unit: p.unit } : {}), ...(p.invoiceNumber ? { invoiceNumber: p.invoiceNumber } : {}), ...(p.date ? { date: p.date } : {}) };
        (account.prices[key] ??= []).push(point);
      }
      account.purchaseOrderCount = poCount;
      account.purchaseOrders = po ? [po] : [];
    }
    const applied: AppliedRuleConfig = {
      scope: stored ? 'user' : 'default',
      config,
      params: { ...DEFAULT_PARAMS, ...config.params },
      asOf,
      account: {
        priorInvoices: account.invoices?.length ?? 0,
        pricePoints: Object.values(account.prices ?? {}).reduce((n, s) => n + s.length, 0),
        purchaseOrders: account.purchaseOrderCount ?? 0,
        ...(account.purchaseOrders?.[0] ? { purchaseOrder: account.purchaseOrders[0].poNumber } : {}),
      },
    };
    return { config, account, asOf, applied };
  }

  listPurchaseOrders(userId: string) {
    return this.repo.listPurchaseOrders(userId);
  }

  /** Imports orders from a CSV or JSON file, or a JSON body; same PO number replaces the earlier one. */
  async importPurchaseOrders(userId: string, input: { file?: { name: string; bytes: Buffer }; body?: unknown }) {
    let orders: PurchaseOrderInput[];
    let source: string;
    if (input.file) {
      source = input.file.name;
      const text = input.file.bytes.toString('utf8');
      if (/\.json$/i.test(input.file.name) || /^\s*[[{]/.test(text)) {
        let json: unknown;
        try {
          json = JSON.parse(text);
        } catch {
          throw new BadRequestException('The file is not valid JSON');
        }
        orders = this.parseJson(json);
      } else {
        const { orders: parsed, errors } = parsePurchaseOrdersCsv(text);
        if (errors.length) throw new BadRequestException({ message: errors.slice(0, 20) });
        orders = this.parseJson(parsed);
      }
    } else {
      source = 'api';
      orders = this.parseJson(input.body);
    }
    const result = await this.repo.upsertPurchaseOrders(userId, orders, source);
    return { ...result, orders: await this.repo.listPurchaseOrders(userId) };
  }

  async deletePurchaseOrder(userId: string, id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id) || !(await this.repo.deletePurchaseOrder(userId, id))) throw new NotFoundException(`Purchase order ${id} not found`);
  }

  private parseJson(json: unknown): PurchaseOrderInput[] {
    const list = Array.isArray(json) ? json : json && typeof json === 'object' && 'orders' in json ? (json as { orders: unknown }).orders : [json];
    const parsed = PurchaseOrdersInput.safeParse(list);
    if (!parsed.success) throw new BadRequestException({ message: 'Invalid purchase orders', issues: parsed.error.issues.slice(0, 20) });
    return parsed.data;
  }
}
