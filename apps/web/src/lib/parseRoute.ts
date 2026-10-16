export type PublicRoute =
  | { name: 'landing' }
  | { name: 'login'; next?: string; ssoError?: string }
  | { name: 'register'; next?: string }
  | { name: 'forgot-password' }
  | { name: 'reset-password'; token?: string }
  | { name: 'invite'; token?: string };

export type AppRoute =
  | { name: 'dashboard' }
  | { name: 'shipments'; due?: 'overdue' | 'soon'; assignee?: string }
  | { name: 'new-shipment' }
  | { name: 'shipment'; id: string }
  | { name: 'samples' }
  | { name: 'inbox'; filter?: string }
  | { name: 'thread'; id: string }
  | { name: 'data-summary' }
  | { name: 'goods'; q?: string; origin?: string; hs?: string }
  | { name: 'companies' }
  | { name: 'company'; id: string }
  | { name: 'products' }
  | { name: 'product'; id: string }
  | { name: 'containers' }
  | { name: 'data-shipments' }
  | { name: 'analytics-kpis' }
  | { name: 'analytics-suppliers' }
  | { name: 'analytics-supplier'; id: string }
  | { name: 'analytics-cost' }
  | { name: 'analytics-prices' }
  | { name: 'analytics-ask' }
  | { name: 'analytics-regulations' }
  | { name: 'rules' }
  | { name: 'rule-settings' }
  | { name: 'results' }
  | { name: 'account' }
  | { name: 'admin-settings' }
  | { name: 'admin-users' }
  | { name: 'admin-system' }
  | { name: 'review-queue' }
  | { name: 'review-document'; id: string }
  | { name: 'usage'; checkout?: string }
  | { name: 'admin-plans' }
  | { name: 'team' }
  | { name: 'audit' }
  | { name: 'approvals' }
  | { name: 'notifications' }
  | { name: 'not-found' };

export type Route = PublicRoute | AppRoute;

const SHIPMENT = /^\/(?:app\/)?s\/([0-9a-f-]{36})$/i;
const THREAD = /^\/app\/inbox\/([0-9a-f-]{36})$/i;
const COMPANY = /^\/app\/companies\/([0-9a-f-]{36})$/i;
const PRODUCT = /^\/app\/products\/([0-9a-f-]{36})$/i;
const SUPPLIER = /^\/app\/analytics\/suppliers\/([0-9a-f-]{36})$/i;
const REVIEW = /^\/app\/review\/([0-9a-f-]{36})$/i;

const APP_PAGES: Record<string, AppRoute> = {
  '/app': { name: 'dashboard' },
  '/app/shipments': { name: 'shipments' },
  '/app/shipments/new': { name: 'new-shipment' },
  '/app/samples': { name: 'samples' },
  '/app/data': { name: 'data-summary' },
  '/app/companies': { name: 'companies' },
  '/app/products': { name: 'products' },
  '/app/containers': { name: 'containers' },
  '/app/data/shipments': { name: 'data-shipments' },
  '/app/analytics': { name: 'analytics-kpis' },
  '/app/analytics/suppliers': { name: 'analytics-suppliers' },
  '/app/analytics/cost': { name: 'analytics-cost' },
  '/app/analytics/prices': { name: 'analytics-prices' },
  '/app/analytics/ask': { name: 'analytics-ask' },
  '/app/analytics/regulations': { name: 'analytics-regulations' },
  '/app/rules': { name: 'rules' },
  '/app/rules/settings': { name: 'rule-settings' },
  '/app/results': { name: 'results' },
  // Links from before the app moved under /app.
  '/results': { name: 'results' },
  '/app/account': { name: 'account' },
  '/app/admin': { name: 'admin-settings' },
  '/app/admin/settings': { name: 'admin-settings' },
  '/app/admin/users': { name: 'admin-users' },
  '/app/admin/system': { name: 'admin-system' },
  '/app/review': { name: 'review-queue' },
  '/app/admin/plans': { name: 'admin-plans' },
  '/app/team': { name: 'team' },
  '/app/audit': { name: 'audit' },
  '/app/approvals': { name: 'approvals' },
  '/app/notifications': { name: 'notifications' },
};

/**
 * "#/" landing, "#/login" and "#/register" (with ?next=<path>), "#/forgot-password",
 * "#/reset-password?token=<emailed token>", everything else under "#/app" ("#/app/companies/<id>",
 * "#/app/products/<id>", "#/app/goods?origin=CN").
 * Old links ("#/s/<id>", "#/results") still open their page.
 */
export function parseRoute(hash: string): Route {
  const [rawPath = '', query = ''] = hash.replace(/^#/, '').split('?');
  const path = rawPath.replace(/\/+$/, '') || '/';
  const params = new URLSearchParams(query);
  const next = params.get('next') ?? undefined;
  if (path === '/') return { name: 'landing' };
  if (path === '/login') return { name: 'login', next, ...(params.get('sso_error') ? { ssoError: params.get('sso_error')! } : {}) };
  if (path === '/invite') return { name: 'invite', token: params.get('token') ?? undefined };
  if (path === '/register') return { name: 'register', next };
  if (path === '/forgot-password') return { name: 'forgot-password' };
  if (path === '/reset-password') return { name: 'reset-password', token: params.get('token') ?? undefined };
  // "#/app/shipments?due=overdue&assignee=me": the dashboard links here with a filter.
  if (path === '/app/shipments' && (params.get('due') || params.get('assignee'))) {
    const due = params.get('due');
    return { name: 'shipments', ...(due === 'overdue' || due === 'soon' ? { due } : {}), ...(params.get('assignee') ? { assignee: params.get('assignee')! } : {}) };
  }
  const id = SHIPMENT.exec(path)?.[1];
  if (id) return { name: 'shipment', id };
  const thread = THREAD.exec(path)?.[1];
  if (thread) return { name: 'thread', id: thread };
  if (path === '/app/inbox') return { name: 'inbox', filter: params.get('filter') || undefined };
  const company = COMPANY.exec(path)?.[1];
  if (company) return { name: 'company', id: company };
  const product = PRODUCT.exec(path)?.[1];
  if (product) return { name: 'product', id: product };
  const supplier = SUPPLIER.exec(path)?.[1];
  if (supplier) return { name: 'analytics-supplier', id: supplier };
  const review = REVIEW.exec(path)?.[1];
  if (review) return { name: 'review-document', id: review };
  // "#/app/usage?checkout=done": back from Stripe Checkout.
  if (path === '/app/usage') return { name: 'usage', checkout: params.get('checkout') || undefined };
  // "#/app/goods?origin=CN&hs=9503&q=bear": the summary links here with a filter.
  if (path === '/app/goods') {
    const opt = (k: string) => params.get(k) || undefined;
    return { name: 'goods', q: opt('q'), origin: opt('origin'), hs: opt('hs') };
  }
  return APP_PAGES[path] ?? { name: 'not-found' };
}
