import { useContext } from 'react';
import { OrgContext, type OrgState } from './OrgContext';

/** The active organization and the user's permissions there. Outside OrgProvider nothing is allowed. */
export function useOrg(): OrgState {
  return (
    useContext(OrgContext) ?? {
      orgs: [],
      can: () => false,
      switchTo: async () => undefined,
      create: async () => undefined,
      refresh: async () => undefined,
    }
  );
}
