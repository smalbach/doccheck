import type { ExtractableType } from '../constants/documentTypes';
import { jsonBody } from './jsonBody';
import { queryString } from './queryString';
import { request } from './request';
import type {
  AdminModels,
  AdminSettings,
  AlertList,
  Destination,
  DocumentDetail,
  Health,
  IsfFiling,
  Results,
  RuleDefinition,
  Sample,
  Shipment,
  ShipmentDocument,
  SettingKey,
  SettingValues,
  ShipmentListQuery,
  ShipmentPage,
  ShipmentUpdate,
  SystemStatus,
  User,
  UserSummary,
  Role,
  Validation,
  ValidationSummary,
  GoodsLine,
  GoodsQuery,
  InsightsSummary,
  Paged,
  ShipmentData,
  ShipmentDataQuery,
} from './types';

const shipmentPath = (id: string) => `/shipments/${encodeURIComponent(id)}`;
const documentPath = (id: string, documentId: string) => `${shipmentPath(id)}/documents/${encodeURIComponent(documentId)}`;

/** Every call the web app makes to the API. */
export const api = {
  health: () => request<Health>('/health'),

  me: () => request<User>('/auth/me'),
  login: (body: { email: string; password: string }) => request<User>('/auth/login', jsonBody(body)),
  register: (body: { email: string; password: string; name: string }) => request<User>('/auth/register', jsonBody(body)),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  updateProfile: (body: { name: string }) => request<User>('/auth/me', { ...jsonBody(body), method: 'PATCH' }),
  changePassword: (body: { currentPassword: string; newPassword: string }) => request<void>('/auth/password', jsonBody(body)),
  deleteAccount: (password: string) => request<void>('/auth/me', { ...jsonBody({ password }), method: 'DELETE' }),

  shipments: (query: ShipmentListQuery = {}) => request<ShipmentPage>(`/shipments${queryString({ ...query })}`),
  alerts: () => request<AlertList>('/shipments/alerts'),
  shipment: (id: string) => request<Shipment>(shipmentPath(id)),
  create: (body: { reference?: string; destination: Destination }) => request<Shipment>('/shipments', jsonBody({ ...body, transportMode: 'SEA' })),
  update: (id: string, body: ShipmentUpdate) => request<Shipment>(shipmentPath(id), { ...jsonBody(body), method: 'PATCH' }),
  remove: (id: string) => request<void>(shipmentPath(id), { method: 'DELETE' }),

  upload: (id: string, files: File[]) => {
    const form = new FormData();
    files.forEach((f) => form.append('files', f));
    return request<{ documents: ShipmentDocument[] }>(`${shipmentPath(id)}/documents`, { method: 'POST', body: form });
  },
  document: (id: string, documentId: string) => request<DocumentDetail>(documentPath(id, documentId)),
  reextract: (id: string, documentId: string, type: ExtractableType) => request<ShipmentDocument>(`${documentPath(id, documentId)}/reextract`, jsonBody({ type })),
  fileUrl: (id: string, documentId: string) => `${documentPath(id, documentId)}/file`,

  validate: (id: string, agent: boolean) => request<{ validationId: string }>(`${shipmentPath(id)}/validate${agent ? '' : '?agent=false'}`, { method: 'POST' }),
  validation: (id: string) => request<Validation>(`${shipmentPath(id)}/validation`),
  validations: (id: string) => request<ValidationSummary[]>(`${shipmentPath(id)}/validations`),
  pastValidation: (id: string, validationId: string) => request<Validation>(`${shipmentPath(id)}/validations/${encodeURIComponent(validationId)}`),
  rules: (destination: Destination) => request<RuleDefinition[]>(`/rules?destination=${destination}`),

  isf: (id: string) => request<IsfFiling>(`${shipmentPath(id)}/isf`),
  saveIsf: (id: string, isf: unknown) => request<IsfFiling>(`${shipmentPath(id)}/isf`, jsonBody(isf, 'PUT')),
  deleteIsf: (id: string) => request<void>(`${shipmentPath(id)}/isf`, { method: 'DELETE' }),

  samples: () => request<Sample[]>('/demo/samples'),
  loadSample: (sampleId: string) => request<Shipment>(`/demo/samples/${encodeURIComponent(sampleId)}`, { method: 'POST' }),

  results: () => request<Results>('/results'),

  insightsSummary: (destination?: Destination) => request<InsightsSummary>(`/insights/summary${queryString({ destination })}`),
  insightsLines: (query: GoodsQuery) => request<Paged<GoodsLine>>(`/insights/lines${queryString({ ...query })}`),
  insightsShipments: (query: ShipmentDataQuery) => request<Paged<ShipmentData>>(`/insights/shipments${queryString({ ...query })}`),
  /** CSV downloads of every matching row, for a plain link: the session cookie goes along. */
  insightsLinesCsvUrl: (filters: Omit<GoodsQuery, 'limit' | 'offset'>) => `/insights/lines.csv${queryString({ ...filters })}`,
  insightsShipmentsCsvUrl: (filters: Omit<ShipmentDataQuery, 'limit' | 'offset'>) => `/insights/shipments.csv${queryString({ ...filters })}`,

  adminSettings: () => request<AdminSettings>('/admin/settings'),
  updateSettings: (values: Partial<SettingValues>) => request<AdminSettings>('/admin/settings', jsonBody(values, 'PUT')),
  resetSetting: (key: SettingKey) => request<AdminSettings>(`/admin/settings/${key}`, { method: 'DELETE' }),
  adminModels: () => request<AdminModels>('/admin/models'),
  adminSystem: () => request<SystemStatus>('/admin/system'),
  adminUsers: () => request<UserSummary[]>('/admin/users'),
  resetPassword: (id: string, newPassword: string) => request<void>(`/admin/users/${encodeURIComponent(id)}/password`, jsonBody({ newPassword })),
  setRole: (id: string, role: Role) => request<UserSummary[]>(`/admin/users/${encodeURIComponent(id)}`, { ...jsonBody({ role }), method: 'PATCH' }),
};
