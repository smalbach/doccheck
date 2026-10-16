import type { DutiesView, DutyInputs } from './dutyTypes';
import { jsonBody } from './jsonBody';
import { request } from './request';

const dutiesPath = (id: string) => `/shipments/${encodeURIComponent(id)}/duties`;

/** Duty estimate routes (kept apart from client.ts so the feature stays in its own files). */
export const dutiesApi = {
  get: (id: string) => request<DutiesView>(dutiesPath(id)),
  /** Saves the answers and returns the new estimate. */
  save: (id: string, inputs: DutyInputs) => request<DutiesView>(`${dutiesPath(id)}/inputs`, jsonBody(inputs, 'PUT')),
  /** The estimate with these answers, not saved (read-only demo). */
  preview: (id: string, inputs: DutyInputs) => request<DutiesView>(`${dutiesPath(id)}/preview`, jsonBody(inputs)),
};
