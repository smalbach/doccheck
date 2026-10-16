import { useState } from 'react';
import { teamApi } from '../../api/teamClient';
import { ORG_ROLES, type Member, type OrgRole } from '../../api/teamTypes';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Select } from '../../components/ui/Select';
import { Tag } from '../../components/ui/Tag';
import { useI18n } from '../../i18n/useI18n';
import { errorMessage } from '../../lib/errorMessage';
import { useAuth } from '../auth/useAuth';
import { useOrg } from './useOrg';

export interface MembersCardProps {
  members: Member[];
  onChange: (members: Member[]) => void;
}

/** Who is in the organization; owners and admins change roles and remove members, anyone can leave. */
export function MembersCard({ members, onChange }: MembersCardProps) {
  const { t, formatDateTime } = useI18n();
  const { user } = useAuth();
  const { org, can } = useOrg();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const manage = can('members.manage');
  const isOwner = org?.role === 'owner';

  const run = async (fn: () => Promise<void>, done?: string) => {
    setError(undefined);
    setNotice(undefined);
    try {
      await fn();
      if (done) setNotice(done);
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  // Only an owner gives or takes ownership.
  const roleOptions = (m: Member) => ORG_ROLES.filter((r) => isOwner || (r !== 'owner' && m.role !== 'owner')).map((r) => ({ value: r, label: t(`team.roles.${r}`) }));

  const columns: Column<Member>[] = [
    {
      key: 'name',
      header: t('team.members.name'),
      cell: (m) => (
        <>
          {m.name} {m.userId === user?.id && <Tag>{t('admin.you')}</Tag>} {m.mfa && <Tag tone="ok">{t('team.members.mfa')}</Tag>}
        </>
      ),
    },
    { key: 'email', header: t('team.members.email'), cell: (m) => m.email, secondary: true },
    {
      key: 'role',
      header: t('team.members.role'),
      cell: (m) =>
        manage && m.userId !== user?.id && (isOwner || m.role !== 'owner') ? (
          <Select<OrgRole>
            value={m.role}
            options={roleOptions(m)}
            ariaLabel={t('team.members.roleOf', { name: m.name })}
            onValueChange={(role) =>
              void run(async () => onChange(await teamApi.setRole(m.userId, role)), t('team.members.roleChanged', { name: m.name, role: t(`team.roles.${role}`) }))
            }
          />
        ) : (
          t(`team.roles.${m.role}`)
        ),
    },
    { key: 'joined', header: t('team.members.joined'), cell: (m) => <span className="muted">{formatDateTime(m.joinedAt)}</span>, secondary: true },
    {
      key: 'actions',
      header: <span className="visually-hidden">{t('admin.columns.actions')}</span>,
      cell: (m) => {
        const self = m.userId === user?.id;
        if (!self && !(manage && (isOwner || m.role !== 'owner'))) return null;
        return (
          <ConfirmDialog
            trigger={
              <Button size="sm" variant="ghost">
                {self ? t('team.members.leave') : t('team.members.remove')}
              </Button>
            }
            title={self ? t('team.members.leaveTitle', { org: org?.name ?? '' }) : t('team.members.removeTitle', { name: m.name })}
            description={self ? t('team.members.leaveText') : t('team.members.removeText')}
            confirmLabel={self ? t('team.members.leave') : t('team.members.remove')}
            onConfirm={() =>
              void run(async () => {
                await teamApi.removeMember(m.userId);
                if (self) {
                  window.location.hash = '#/app';
                  window.location.reload();
                } else onChange(members.filter((x) => x.userId !== m.userId));
              })
            }
          />
        );
      },
    },
  ];
  return (
    <Card title={t('team.members.title', { count: members.length })}>
      {error && <Banner tone="error">{error}</Banner>}
      {notice && <Banner tone="ok">{notice}</Banner>}
      <DataTable columns={columns} rows={members} rowKey={(m) => m.userId} caption={t('team.members.caption')} />
      <details className="role-help">
        <summary>{t('team.members.rolesHelp')}</summary>
        <dl className="status-list">
          {ORG_ROLES.map((r) => (
            <div key={r} className="status-item">
              <dt>{t(`team.roles.${r}`)}</dt>
              <dd>{t(`team.roleHelp.${r}`)}</dd>
            </div>
          ))}
        </dl>
      </details>
    </Card>
  );
}
