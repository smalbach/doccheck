import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../../api/client';
import type { MailServerInput, MailServerSettings, PlusCheck } from '../../../api/types';
import { LoadingCard } from '../../../components/layout/LoadingCard';
import { Banner } from '../../../components/ui/Banner';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Checkbox } from '../../../components/ui/Checkbox';
import { Field } from '../../../components/ui/Field';
import { Select } from '../../../components/ui/Select';
import { TextInput } from '../../../components/ui/TextInput';
import { useI18n } from '../../../i18n/useI18n';
import { errorMessage } from '../../../lib/errorMessage';

type Preset = 'gmail' | 'outlook' | 'resend' | 'zoho' | 'custom';
type Server = { host: string; port: string; secure: boolean; user: string; password: string };

/** Hosts and ports of common providers; "custom" leaves the fields as they are. */
const PRESETS: Record<Exclude<Preset, 'custom'>, { smtp: Omit<Server, 'user' | 'password'> & { user?: string }; imap?: Omit<Server, 'user' | 'password'> }> = {
  gmail: { smtp: { host: 'smtp.gmail.com', port: '465', secure: true }, imap: { host: 'imap.gmail.com', port: '993', secure: true } },
  outlook: { smtp: { host: 'smtp.office365.com', port: '587', secure: false }, imap: { host: 'outlook.office365.com', port: '993', secure: true } },
  resend: { smtp: { host: 'smtp.resend.com', port: '465', secure: true, user: 'resend' } },
  zoho: { smtp: { host: 'smtp.zoho.com', port: '465', secure: true }, imap: { host: 'imap.zoho.com', port: '993', secure: true } },
};

const empty: Server = { host: '', port: '', secure: true, user: '', password: '' };

interface Draft {
  smtpOn: boolean;
  smtp: Server;
  from: string;
  replyTo: string;
  plusAddressing: boolean;
  imapOn: boolean;
  imap: Server & { mailbox: string; pollSeconds: string };
  intake: { enabled: boolean; notifySender: boolean };
}

function draftOf(s: MailServerSettings): Draft {
  const c = s.config;
  return {
    smtpOn: !!c?.smtp,
    smtp: c?.smtp ? { host: c.smtp.host, port: String(c.smtp.port), secure: c.smtp.secure, user: c.smtp.user, password: '' } : { ...empty, port: '465' },
    from: c?.from ?? '',
    replyTo: c?.replyTo ?? '',
    plusAddressing: c?.plusAddressing ?? true,
    imapOn: !!c?.imap,
    imap: c?.imap
      ? { host: c.imap.host, port: String(c.imap.port), secure: c.imap.secure, user: c.imap.user, password: '', mailbox: c.imap.mailbox, pollSeconds: String(c.imap.pollSeconds) }
      : { ...empty, port: '993', mailbox: 'INBOX', pollSeconds: '60' },
    intake: c?.intake ?? { enabled: false, notifySender: true },
  };
}

function inputOf(d: Draft): MailServerInput {
  return {
    smtp: d.smtpOn ? { host: d.smtp.host.trim(), port: Number(d.smtp.port), secure: d.smtp.secure, user: d.smtp.user.trim(), ...(d.smtp.password ? { password: d.smtp.password } : {}) } : null,
    from: d.from.trim(),
    replyTo: d.replyTo.trim() || null,
    plusAddressing: d.plusAddressing,
    imap: d.imapOn
      ? {
          host: d.imap.host.trim(),
          port: Number(d.imap.port),
          secure: d.imap.secure,
          user: d.imap.user.trim(),
          ...(d.imap.password ? { password: d.imap.password } : {}),
          mailbox: d.imap.mailbox.trim() || 'INBOX',
          pollSeconds: Number(d.imap.pollSeconds) || 60,
        }
      : null,
    intake: d.intake,
  };
}

/**
 * The mailbox DocCheck sends from (SMTP) and reads (IMAP), and documents by email. Presets fill the
 * servers of common providers; tests run on the values in the form, before saving.
 */
export function MailboxSettingsCard() {
  const { t, formatDateTime } = useI18n();
  const [settings, setSettings] = useState<MailServerSettings>();
  const [draft, setDraft] = useState<Draft>();
  const [preset, setPreset] = useState<Preset>('custom');
  const [busy, setBusy] = useState<'save' | 'smtp' | 'imap' | 'reset'>();
  const [status, setStatus] = useState<{ tone: 'ok' | 'error'; text: string }>();
  const [error, setError] = useState<string>();

  const load = (s: MailServerSettings) => {
    setSettings(s);
    setDraft(draftOf(s));
  };
  useEffect(() => {
    api.adminMail().then(load, (e: unknown) => setError(errorMessage(e)));
  }, []);
  // While the +code check waits for its test email, look again now and then.
  const checking = settings?.plusCheck?.status === 'checking';
  useEffect(() => {
    if (!checking) return;
    const timer = setInterval(() => api.adminMail().then((s) => setSettings((current) => (current ? { ...current, plusCheck: s.plusCheck } : s)), () => undefined), 15_000);
    return () => clearInterval(timer);
  }, [checking]);
  if (!settings || !draft) return <LoadingCard error={error} />;
  const editable = settings.editable;
  const c = settings.config;

  const applyPreset = (p: Preset) => {
    setPreset(p);
    if (p === 'custom') return;
    const { smtp, imap } = PRESETS[p];
    setDraft((d) =>
      d && {
        ...d,
        smtpOn: true,
        smtp: { ...d.smtp, host: smtp.host, port: smtp.port, secure: smtp.secure, user: smtp.user ?? d.smtp.user },
        ...(imap ? { imapOn: true, imap: { ...d.imap, host: imap.host, port: imap.port, secure: imap.secure } } : {}),
      },
    );
  };
  const patch = (next: Partial<Draft>) => setDraft((d) => d && { ...d, ...next });
  const run = async (kind: 'save' | 'smtp' | 'imap' | 'reset', work: () => Promise<void>) => {
    setBusy(kind);
    setStatus(undefined);
    try {
      await work();
    } catch (err) {
      setStatus({ tone: 'error', text: errorMessage(err) });
    } finally {
      setBusy(undefined);
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run('save', async () => {
      load(await api.saveAdminMail(inputOf(draft)));
      setStatus({ tone: 'ok', text: t('mail.settings.saved') });
    });
  };
  const test = (kind: 'smtp' | 'imap') =>
    run(kind, async () => {
      const r = await api.testAdminMail(kind, inputOf(draft));
      setStatus({ tone: r.ok ? 'ok' : 'error', text: r.detail });
    });

  const server = (kind: 'smtp' | 'imap') => {
    const s = draft[kind];
    const set = (next: Partial<Server>) => patch({ [kind]: { ...s, ...next } } as Partial<Draft>);
    const saved = kind === 'smtp' ? c?.smtp?.hasPassword : c?.imap?.hasPassword;
    return (
      <>
        <div className="setting-row">
          <Field label={t('mail.settings.host')} grow>
            {(id) => <TextInput id={id} value={s.host} onChange={(e) => set({ host: e.target.value })} disabled={!editable} autoComplete="off" spellCheck={false} />}
          </Field>
          <Field label={t('mail.settings.port')}>
            {(id) => <TextInput id={id} value={s.port} inputMode="numeric" className="input-short" onChange={(e) => set({ port: e.target.value })} disabled={!editable} />}
          </Field>
        </div>
        <Checkbox label={t('mail.settings.tls')} checked={s.secure} onCheckedChange={(secure) => set({ secure })} disabled={!editable} />
        <div className="setting-row">
          <Field label={t('mail.settings.user')} grow>
            {(id) => <TextInput id={id} value={s.user} onChange={(e) => set({ user: e.target.value })} disabled={!editable} autoComplete="off" spellCheck={false} />}
          </Field>
          <Field label={t('mail.settings.password')} grow>
            {(id) => (
              <TextInput
                id={id}
                type="password"
                value={s.password}
                placeholder={saved ? t('mail.settings.passwordSaved') : ''}
                onChange={(e) => set({ password: e.target.value })}
                disabled={!editable}
                autoComplete="new-password"
              />
            )}
          </Field>
        </div>
      </>
    );
  };

  return (
    <Card title={t('mail.settings.title')} aside={<span className="muted small">{t(`mail.settings.source.${settings.source}`)}</span>}>
      <p className="muted">{t('mail.settings.text')}</p>
      <form className="stack-form" onSubmit={submit} noValidate>
        <Field label={t('mail.settings.preset')}>
          {(id) => (
            <Select
              id={id}
              value={preset}
              options={(['gmail', 'outlook', 'resend', 'zoho', 'custom'] as const).map((p) => ({ value: p, label: t(`mail.settings.presets.${p}`) }))}
              onValueChange={applyPreset}
              disabled={!editable}
            />
          )}
        </Field>
        <p className="muted small">{t('mail.settings.passwordHint')}</p>

        <fieldset className="fieldset">
          <legend className="field-label">{t('mail.settings.sending')}</legend>
          {server('smtp')}
          <Field label={t('mail.settings.from')}>
            {(id) => <TextInput id={id} value={draft.from} placeholder="DocCheck <docs@example.com>" onChange={(e) => patch({ from: e.target.value })} disabled={!editable} />}
          </Field>
        </fieldset>

        <fieldset className="fieldset">
          <legend className="field-label">{t('mail.settings.receiving')}</legend>
          <Checkbox label={t('mail.settings.receivingOn')} checked={draft.imapOn} onCheckedChange={(imapOn) => patch({ imapOn })} disabled={!editable} />
          {draft.imapOn && (
            <>
              {server('imap')}
              <div className="setting-row">
                <Field label={t('mail.settings.mailbox')} grow>
                  {(id) => <TextInput id={id} value={draft.imap.mailbox} onChange={(e) => patch({ imap: { ...draft.imap, mailbox: e.target.value } })} disabled={!editable} />}
                </Field>
                <Field label={t('mail.settings.poll')}>
                  {(id) => <TextInput id={id} value={draft.imap.pollSeconds} inputMode="numeric" className="input-short" onChange={(e) => patch({ imap: { ...draft.imap, pollSeconds: e.target.value } })} disabled={!editable} />}
                </Field>
              </div>
              <Field label={`${t('mail.settings.replyTo')} · ${t('mail.settings.replyToHint')}`}>
                {(id) => <TextInput id={id} type="email" value={draft.replyTo} onChange={(e) => patch({ replyTo: e.target.value })} disabled={!editable} />}
              </Field>
              <Checkbox label={t('mail.settings.plus')} checked={draft.plusAddressing} onCheckedChange={(plusAddressing) => patch({ plusAddressing })} disabled={!editable} />
            </>
          )}
          {settings.plusCheck && <PlusCheckBanner check={settings.plusCheck} />}
        </fieldset>

        <fieldset className="fieldset">
          <legend className="field-label">{t('mail.settings.intake')}</legend>
          <Checkbox label={t('mail.settings.intakeOn')} checked={draft.intake.enabled} onCheckedChange={(enabled) => patch({ intake: { ...draft.intake, enabled } })} disabled={!editable} />
          <p className="muted small">{t('mail.settings.intakeHelp')}</p>
          <Checkbox label={t('mail.settings.notify')} checked={draft.intake.notifySender} onCheckedChange={(notifySender) => patch({ intake: { ...draft.intake, notifySender } })} disabled={!editable || !draft.intake.enabled} />
        </fieldset>

        {status && <Banner tone={status.tone}>{status.text}</Banner>}
        {settings.updatedAt && settings.source === 'admin' && <p className="muted small">{t('mail.settings.updated', { who: settings.updatedBy ?? '—', date: formatDateTime(settings.updatedAt) })}</p>}
        {editable && (
          <div className="dialog-actions mail-settings-actions">
            <Button type="submit" variant="primary" disabled={!!busy}>
              {t('mail.settings.save')}
            </Button>
            <Button onClick={() => void test('smtp')} disabled={!!busy || !draft.smtpOn}>
              {t('mail.settings.testSend')}
            </Button>
            <Button onClick={() => void test('imap')} disabled={!!busy || !draft.imapOn}>
              {t('mail.settings.testRead')}
            </Button>
            {settings.source === 'admin' && (
              <Button variant="ghost" onClick={() => void run('reset', async () => load(await api.resetAdminMail()))} disabled={!!busy}>
                {t('mail.settings.reset')}
              </Button>
            )}
          </div>
        )}
      </form>
    </Card>
  );
}

/** What the +code check found: a rejection says why +codes are off and what still works. */
function PlusCheckBanner({ check }: { check: PlusCheck }) {
  const { t } = useI18n();
  const vars = { address: check.address, detail: check.detail ?? '' };
  if (check.status === 'ok') return <Banner tone="ok">{t('mail.settings.plusCheck.ok', vars)}</Banner>;
  if (check.status === 'checking') return <Banner tone="info">{t('mail.settings.plusCheck.checking', vars)}</Banner>;
  if (check.status === 'unconfirmed') return <Banner tone="warning">{t('mail.settings.plusCheck.unconfirmed', vars)}</Banner>;
  return (
    <Banner tone="warning">
      {t('mail.settings.plusCheck.rejected', vars)} {t(check.turnedOff ? 'mail.settings.plusCheck.turnedOff' : 'mail.settings.plusCheck.turnOff')}
    </Banner>
  );
}
