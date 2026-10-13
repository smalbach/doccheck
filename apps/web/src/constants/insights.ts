import type { MessageKey } from '../i18n/keys';

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
