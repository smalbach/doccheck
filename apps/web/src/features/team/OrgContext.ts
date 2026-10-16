import { createContext } from 'react';
import type { OrgPermission, OrgSummary } from '../../api/teamTypes';

export interface OrgState {
  /** The organization this session works in; undefined until loaded (or signed out). */
  org?: OrgSummary;
  orgs: OrgSummary[];
  /** What the user may do in the active organization (the API checks again on every request). */
  can: (permission: OrgPermission) => boolean;
  switchTo: (id: string) => Promise<void>;
  create: (name: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export const OrgContext = createContext<OrgState | null>(null);
