import type { ExtractableType } from '../constants/documentTypes';
import { jsonBody } from './jsonBody';
import { request } from './request';
import type {
  AdminModels,
  AdminSettings,
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
  ShipmentSummary,
  SystemStatus,
  User,
  UserSummary,
  Role,
  Validation,
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

  shipments: () => request<ShipmentSummary[]>('/shipments'),
  shipment: (id: string) => request<Shipment>(shipmentPath(id)),
  create: (body: { reference?: string; destination: Destination }) => request<Shipment>('/shipments', jsonBody({ ...body, transportMode: 'SEA' })),
  remove: (id: string) => request<void>(shipmentPath(id), { method: 'DELETE' }),

  upload: (id: string, files: File[]) => {
    const form = new FormData();
    files.forEach((f) => form.append('files', f));
    return request<{ documents: ShipmentDocument[] }>(`${shipmentPath(id)}/documents`, { method: 'POST', body: form });
  },
  document: (id: string, documentId: string) => request<DocumentDetail>(documentPath(id, documentId)),
  reextract: (id: string, documentId: string, type: ExtractableType) => request<ShipmentDocument>(`${documentPath(id, documentId)}/reextract`, jsonBody({ type })),
  fileUrl: (id: string, documentId: string) => `${documentPath(id, documentId)}/file`,

  validate: (id: string, agent: boolean) => request<Validation>(`${shipmentPath(id)}/validate${agent ? '' : '?agent=false'}`, { method: 'POST' }),
  validation: (id: string) => request<Validation>(`${shipmentPath(id)}/validation`),
  rules: (destination: Destination) => request<RuleDefinition[]>(`/rules?destination=${destination}`),

  isf: (id: string) => request<IsfFiling>(`${shipmentPath(id)}/isf`),
  saveIsf: (id: string, isf: unknown) => request<IsfFiling>(`${shipmentPath(id)}/isf`, jsonBody(isf, 'PUT')),
  deleteIsf: (id: string) => request<void>(`${shipmentPath(id)}/isf`, { method: 'DELETE' }),

  samples: () => request<Sample[]>('/demo/samples'),
  loadSample: (sampleId: string) => request<Shipment>(`/demo/samples/${encodeURIComponent(sampleId)}`, { method: 'POST' }),

  results: () => request<Results>('/results'),

  adminSettings: () => request<AdminSettings>('/admin/settings'),
  updateSettings: (values: Partial<SettingValues>) => request<AdminSettings>('/admin/settings', jsonBody(values, 'PUT')),
  resetSetting: (key: SettingKey) => request<AdminSettings>(`/admin/settings/${key}`, { method: 'DELETE' }),
  adminModels: () => request<AdminModels>('/admin/models'),
  adminSystem: () => request<SystemStatus>('/admin/system'),
  adminUsers: () => request<UserSummary[]>('/admin/users'),
  setRole: (id: string, role: Role) => request<UserSummary[]>(`/admin/users/${encodeURIComponent(id)}`, { ...jsonBody({ role }), method: 'PATCH' }),
};
