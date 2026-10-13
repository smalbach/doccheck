import type { MessageKey } from '../i18n/keys';

export type InsightsTab = 'summary' | 'goods' | 'parties' | 'products' | 'shipments';

export const INSIGHTS_TABS: readonly { value: InsightsTab; labelKey: MessageKey }[] = [
  { value: 'summary', labelKey: 'insights.tabs.summary' },
  { value: 'goods', labelKey: 'insights.tabs.goods' },
  { value: 'parties', labelKey: 'insights.tabs.parties' },
  { value: 'products', labelKey: 'insights.tabs.products' },
  { value: 'shipments', labelKey: 'insights.tabs.shipments' },
];

export const INSIGHTS_PAGE_SIZE = 50;

export interface GoodsFilterState {
  query: string;
  origin: string;
  hs: string;
}

export const INITIAL_GOODS_FILTERS: GoodsFilterState = { query: '', origin: '', hs: '' };

export type PartyRoleFilter = 'any' | 'supplier' | 'customer';

export const PARTY_ROLE_FILTERS: readonly { value: PartyRoleFilter; labelKey: MessageKey }[] = [
  { value: 'any', labelKey: 'insights.parties.roleAny' },
  { value: 'supplier', labelKey: 'insights.parties.roleSupplier' },
  { value: 'customer', labelKey: 'insights.parties.roleCustomer' },
];

/** What a row of the companies or products tab opens. */
export type InsightsEntity = { kind: 'party' | 'product'; id: string };
