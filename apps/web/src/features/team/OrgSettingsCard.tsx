import { useState, type FormEvent } from 'react';
import { teamApi } from '../../api/teamClient';
import type { OrgSettings } from '../../api/teamTypes';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Field } from '../../components/ui/Field';
import { Switch } from '../../components/ui/Switch';
import { TextInput } from '../../components/ui/TextInput';
import { useQuery } from '../../hooks/useQuery';
import { useI18n } from '../../i18n/useI18n';
import { errorMessage } from '../../lib/errorMessage';

/** Name, two-step approval, due date lead time and records retention (owners and admins). */
export function OrgSettingsCard({ settings, onSaved }: { settings: OrgSettings; onSaved: (s: OrgSettings) => void }) {
  const { t } = useI18n();
  const [form, setForm] = useState(settings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [version, setVersion] = useState(0);
  const { data: preview } = useQuery(`retention:${version}`, teamApi.retentionPreview);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const saved = await teamApi.updateOrg(form);
      onSaved(saved);
      setForm(saved);
      setNotice(t('team.settings.saved'));
      setVersion((v) => v + 1);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const runRetention = async () => {
    setError(undefined);
    try {
      const r = await teamApi.runRetention();
      setNotice(t('team.retention.done', { count: r.deleted }));
      setVersion((v) => v + 1);
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  const number = (key: 'retentionCaYears' | 'retentionUsYears' | 'slaEtaLeadHours', label: string, min: number, max: number) => (
    <Field label={label}>
      {(id) => (
        <TextInput
          id={id}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          required
          className="input-short"
          value={String(form[key])}
          onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) })}
        />
      )}
    </Field>
  );

  return (
    <Card title={t('team.settings.title')}>
      <form className="stack-form" onSubmit={(e) => void submit(e)}>
        {error && <Banner tone="error">{error}</Banner>}
        {notice && <Banner tone="ok">{notice}</Banner>}
        <Field label={t('team.settings.name')}>{(id) => <TextInput id={id} required maxLength={100} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}</Field>
        <Switch label={t('team.settings.requireApproval')} checked={form.requireApproval} onCheckedChange={(requireApproval) => setForm({ ...form, requireApproval })} />
        <p className="muted small">{t('team.settings.requireApprovalHelp')}</p>
        {number('slaEtaLeadHours', t('team.settings.leadHours'), 0, 720)}
        <p className="muted small">{t('team.settings.leadHoursHelp')}</p>
        <fieldset className="fieldset">
          <legend>{t('team.retention.title')}</legend>
          <div className="setting-row">
            {number('retentionCaYears', t('team.retention.ca'), 1, 50)}
            {number('retentionUsYears', t('team.retention.us'), 1, 50)}
          </div>
          <p className="muted small">{t('team.retention.help')}</p>
        </fieldset>
        <div className="setting-row">
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </form>
      {preview && (
        <div className="setting-row retention-run">
          <p className="muted" role="status">
            {t('team.retention.expired', { count: preview.expired })}
          </p>
          {preview.expired > 0 && (
            <ConfirmDialog
              trigger={<Button variant="danger">{t('team.retention.run')}</Button>}
              title={t('team.retention.runTitle', { count: preview.expired })}
              description={t('team.retention.runText')}
              confirmLabel={t('team.retention.run')}
              onConfirm={() => void runRetention()}
            />
          )}
        </div>
      )}
    </Card>
  );
}
