import { jsonBody } from './jsonBody';
import { request } from './request';

export type UsageKind = 'extraction' | 'validation';
export type MeterState = 'ok' | 'warning' | 'over' | 'blocked';

export interface Plan {
  id: string;
  name: string;
  position: number;
  extractionsPerMonth: number | null;
  validationsPerMonth: number | null;
  warnPercent: number;
  enforcement: 'soft' | 'hard';
}

export interface Meter {
  kind: UsageKind;
  used: number;
  limit: number | null;
  remaining: number | null;
  percent: number | null;
  state: MeterState;
}

export interface Usage {
  plan: Plan;
  month: string;
  resetsAt: string;
  meters: Meter[];
  enforced: boolean;
  history: { month: string; extraction: number; validation: number }[];
}

export interface BillingStatus {
  enabled: boolean;
  plans: string[];
}

export interface AccountUsage {
  month: string;
  accounts: { userId: string; email: string; plan: string; extraction: number; validation: number }[];
}

export type PlanInput = Omit<Plan, 'id' | 'position'>;

/** Usage, plans and (test-mode) billing calls. */
export const usageApi = {
  usage: () => request<Usage>('/usage'),
  plans: () => request<Plan[]>('/usage/plans'),
  billing: () => request<BillingStatus>('/billing'),
  checkout: (plan: string) => request<{ url: string }>('/billing/checkout', jsonBody({ plan })),
  portal: () => request<{ url: string }>('/billing/portal', { method: 'POST' }),
  updatePlan: (id: string, plan: PlanInput) => request<Plan>(`/admin/plans/${encodeURIComponent(id)}`, { ...jsonBody(plan), method: 'PUT' }),
  accounts: () => request<AccountUsage>('/admin/usage'),
  setPlan: (userId: string, plan: string) => request<AccountUsage>(`/admin/usage/${encodeURIComponent(userId)}/plan`, { ...jsonBody({ plan }), method: 'PUT' }),
};
