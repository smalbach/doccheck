import { useState, type FormEvent } from 'react';
import { teamApi } from '../../api/teamClient';
import { ASSIGNABLE_ROLES, type Invite, type OrgRole } from '../../api/teamTypes';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Field } from '../../components/ui/Field';
import { Select } from '../../components/ui/Select';
import { TextInput } from '../../components/ui/TextInput';
import { useQuery } from '../../hooks/useQuery';
import { useI18n } from '../../i18n/useI18n';
import { errorMessage } from '../../lib/errorMessage';

/** Invitations by email (owners and admins): the link works 7 days, for that address only. */
export function InvitesCard() {
  const { t, formatDateTime } = useI18n();
  const [version, setVersion] = useState(0);
  const { data: invites, error: loadError } = useQuery(`invites:${version}`, teamApi.invites);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OrgRole>('analyst');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const sent = await teamApi.invite(email.trim(), role);
      setNotice(t('team.invites.sent', { email: sent.email }));
      setEmail('');
      setVersion((v) => v + 1);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<Invite>[] = [
    { key: 'email', header: t('team.members.email'), cell: (i) => i.email },
    { key: 'role', header: t('team.members.role'), cell: (i) => t(`team.roles.${i.role}`) },
    { key: 'expires', header: t('team.invites.expires'), cell: (i) => <span className="muted">{formatDateTime(i.expiresAt)}</span>, secondary: true },
    {
      key: 'actions',
      header: <span className="visually-hidden">{t('admin.columns.actions')}</span>,
      cell: (i) => (
        <Button
          size="sm"
          variant="ghost"
          aria-label={t('team.invites.revokeOne', { email: i.email })}
          onClick={() => void teamApi.revokeInvite(i.id).then(() => setVersion((v) => v + 1), (err: unknown) => setError(errorMessage(err)))}
        >
          {t('team.invites.revoke')}
        </Button>
      ),
    },
  ];
  return (
    <Card title={t('team.invites.title')}>
      <p className="muted">{t('team.invites.text')}</p>
      <form className="setting-row" onSubmit={(e) => void submit(e)}>
        <Field label={t('team.members.email')} grow>
          {(id) => <TextInput id={id} type="email" required autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />}
        </Field>
        <Field label={t('team.members.role')}>
          {(id) => <Select<OrgRole> id={id} value={role} options={ASSIGNABLE_ROLES.map((r) => ({ value: r, label: t(`team.roles.${r}`) }))} onValueChange={setRole} />}
        </Field>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? t('team.invites.sending') : t('team.invites.send')}
        </Button>
      </form>
      {(error || loadError) && <Banner tone="error">{error ?? loadError}</Banner>}
      {notice && <Banner tone="ok">{notice}</Banner>}
      {invites && invites.length > 0 && <DataTable columns={columns} rows={invites} rowKey={(i) => i.id} caption={t('team.invites.pending')} />}
    </Card>
  );
}
