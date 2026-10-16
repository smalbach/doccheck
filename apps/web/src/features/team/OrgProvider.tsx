import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { teamApi } from '../../api/teamClient';
import type { OrgPermission, OrgSummary } from '../../api/teamTypes';
import { useAuth } from '../auth/useAuth';
import { OrgContext, type OrgState } from './OrgContext';

/** Reloads the app in the dashboard, so every page asks for the new organization's data. */
const reopen = () => {
  window.location.hash = '#/app';
  window.location.reload();
};

/** Loads the user's organizations once signed in; switching reloads the app in the other one. */
export function OrgProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [orgs, setOrgs] = useState<OrgSummary[]>([]);
  const [org, setOrg] = useState<OrgSummary>();

  const refresh = useCallback(async () => {
    const res = await teamApi.orgs();
    setOrgs(res.items);
    setOrg(res.active ?? res.items[0]);
  }, []);

  useEffect(() => {
    if (!user) {
      setOrgs([]);
      setOrg(undefined);
      return;
    }
    void refresh().catch(() => undefined);
  }, [user, refresh]);

  const switchTo = useCallback(async (id: string) => {
    await teamApi.switchOrg(id);
    reopen();
  }, []);
  const create = useCallback(async (name: string) => {
    await teamApi.createOrg(name);
    reopen();
  }, []);
  const can = useCallback((permission: OrgPermission) => !!org?.permissions.includes(permission), [org]);

  const value = useMemo<OrgState>(() => ({ org, orgs, can, switchTo, create, refresh }), [org, orgs, can, switchTo, create, refresh]);
  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}
