import { useState } from 'react';
import type { UserSummary } from '../../../api/types';
import { LoadingCard } from '../../../components/layout/LoadingCard';
import { Banner } from '../../../components/ui/Banner';
import { Card } from '../../../components/ui/Card';
import { DataTable, type Column } from '../../../components/ui/DataTable';
import { PageHeader } from '../../../components/ui/PageHeader';
import { Tag } from '../../../components/ui/Tag';
import { useDemo } from '../../../hooks/useDemo';
import { useI18n } from '../../../i18n/useI18n';
import { useAuth } from '../../auth/useAuth';
import { ResetPasswordDialog } from './ResetPasswordDialog';
import { RoleSelect } from './RoleSelect';
import { useAdminUsers } from './useAdminUsers';

export function UsersPage() {
  const { t, formatDateTime } = useI18n();
  const { user: me } = useAuth();
  const demo = useDemo();
  const { users, error, busy, setRole } = useAdminUsers();
  const [notice, setNotice] = useState<string>();
  if (!users) return <LoadingCard error={error} />;

  const columns: Column<UserSummary>[] = [
    {
      key: 'name',
      header: t('admin.columns.name'),
      cell: (u) => (
        <>
          {u.name} {u.id === me?.id && <Tag>{t('admin.you')}</Tag>}
        </>
      ),
    },
    { key: 'email', header: t('admin.columns.email'), cell: (u) => u.email },
    {
      key: 'role',
      header: t('admin.columns.role'),
      cell: (u) => (
        <RoleSelect
          user={u}
          isSelf={u.id === me?.id}
          disabled={demo || busy !== undefined}
          onChange={(role) => {
            setNotice(undefined);
            void setRole(u.id, role).then((ok) => ok && setNotice(t('admin.roleChanged', { name: u.name, role: t(`admin.roles.${role}`) })));
          }}
        />
      ),
    },
    { key: 'shipments', header: t('admin.columns.shipments'), cell: (u) => u.shipmentCount, numeric: true, secondary: true },
    {
      key: 'actions',
      header: <span className="visually-hidden">{t('admin.columns.actions')}</span>,
      cell: (u) => (u.id === me?.id ? null : <ResetPasswordDialog user={u} disabled={demo} onDone={setNotice} />),
    },
    { key: 'created', header: t('admin.columns.created'), cell: (u) => <span className="muted">{formatDateTime(u.createdAt)}</span>, secondary: true },
  ];
  return (
    <div className="page">
      <PageHeader title={t('admin.users')} description={t('admin.usersDescription')} />
      {error && <Banner tone="error">{error}</Banner>}
      {notice && <Banner tone="ok">{notice}</Banner>}
      <Card>
        <DataTable columns={columns} rows={users} rowKey={(u) => u.id} caption={t('admin.users')} />
      </Card>
    </div>
  );
}
