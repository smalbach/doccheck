import type { MessageKey } from '../i18n/keys';

export type InsightsTab = 'summary' | 'goods' | 'shipments';

export const INSIGHTS_TABS: readonly { value: InsightsTab; labelKey: MessageKey }[] = [
  { value: 'summary', labelKey: 'insights.tabs.summary' },
  { value: 'goods', labelKey: 'insights.tabs.goods' },
  { value: 'shipments', labelKey: 'insights.tabs.shipments' },
];

export const INSIGHTS_PAGE_SIZE = 50;

export interface GoodsFilterState {
  query: string;
  origin: string;
  hs: string;
}

export const INITIAL_GOODS_FILTERS: GoodsFilterState = { query: '', origin: '', hs: '' };
