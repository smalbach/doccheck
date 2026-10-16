import { useEffect, useState } from 'react';
import { teamApi } from '../../api/teamClient';
import type { Member, OrgSettings } from '../../api/teamTypes';
import { LoadingCard } from '../../components/layout/LoadingCard';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { PageHeader } from '../../components/ui/PageHeader';
import { useQuery } from '../../hooks/useQuery';
import { useI18n } from '../../i18n/useI18n';
import { errorMessage } from '../../lib/errorMessage';
import { InvitesCard } from './InvitesCard';
import { MembersCard } from './MembersCard';
import { OrgSettingsCard } from './OrgSettingsCard';
import { SsoCard } from './SsoCard';
import { useOrg } from './useOrg';

/** The active organization: members and roles, invitations, settings, single sign-on. */
export function TeamPage() {
  const { t } = useI18n();
  const { org, can, refresh } = useOrg();
  const { data: loaded, error } = useQuery(`members:${org?.id}`, teamApi.members);
  const { data: current } = useQuery(`org:${org?.id}`, teamApi.currentOrg);
  const [members, setMembers] = useState<Member[]>();
  const [settings, setSettings] = useState<OrgSettings>();
  const [deleteError, setDeleteError] = useState<string>();
  useEffect(() => setMembers(loaded), [loaded]);
  useEffect(() => setSettings(current?.settings), [current]);
  if (!org || !members) return <LoadingCard error={error} />;

  return (
    <div className="page page-narrow">
      <PageHeader title={org.name} eyebrow={t('team.title')} description={org.personal ? t('team.personalText') : t('team.text')} />
      <MembersCard members={members} onChange={setMembers} />
      {can('members.manage') && <InvitesCard />}
      {can('org.settings') && settings && (
        <OrgSettingsCard
          settings={settings}
          onSaved={(s) => {
            setSettings(s);
            void refresh();
          }}
        />
      )}
      {can('org.settings') && <SsoCard />}
      {can('org.delete') && !org.personal && (
        <Card title={t('team.delete.title')} className="danger-zone">
          <p className="muted">{t('team.delete.text')}</p>
          {deleteError && <Banner tone="error">{deleteError}</Banner>}
          <ConfirmDialog
            trigger={<Button variant="danger">{t('team.delete.button')}</Button>}
            title={t('team.delete.confirmTitle', { name: org.name })}
            description={t('team.delete.confirmText')}
            confirmLabel={t('team.delete.button')}
            onConfirm={() =>
              void teamApi.deleteOrg().then(
                () => {
                  window.location.hash = '#/app';
                  window.location.reload();
                },
                (err: unknown) => setDeleteError(errorMessage(err)),
              )
            }
          />
        </Card>
      )}
    </div>
  );
}
