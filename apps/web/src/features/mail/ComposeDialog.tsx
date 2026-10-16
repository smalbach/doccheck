import { EnvelopeClosedIcon } from '@radix-ui/react-icons';
import { Dialog } from 'radix-ui';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api } from '../../api/client';
import type { MailContact, ShipmentDocument, ThreadKind, ValidationFinding } from '../../api/types';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Checkbox } from '../../components/ui/Checkbox';
import { Field } from '../../components/ui/Field';
import { Select } from '../../components/ui/Select';
import { TextInput } from '../../components/ui/TextInput';
import { ToggleChips } from '../../components/ui/ToggleChips';
import { refreshMailSummary } from '../../hooks/useMailSummary';
import type { MessageKey, MessageVars } from '../../i18n/keys';
import { loadMessages } from '../../i18n/loadMessages';
import { LOCALES, type Locale } from '../../i18n/locales';
import type { Messages } from '../../i18n/messages/en';
import { translate } from '../../i18n/translate';
import { useI18n } from '../../i18n/useI18n';
import { errorMessage } from '../../lib/errorMessage';
import { ruleGuideKey } from '../../lib/findingReview';
import { parseAddresses } from '../../lib/parseAddresses';
import { supplierLetter } from '../../lib/supplierLetter';

export interface ComposeDialogProps {
  /** request: asks for corrected documents about `findings`; message: any email about a shipment or a company. */
  mode: 'request' | 'message';
  shipmentId?: string;
  partyId?: string;
  /** Shipment reference, in the request's subject and text. */
  reference?: string;
  findings?: readonly ValidationFinding[];
  documents?: ReadonlyMap<string, ShipmentDocument>;
  disabled?: boolean;
  /** Fingerprints picked when it opens (default: every finding). */
  preselect?: readonly string[];
  /** The button that opens it, when not the default one. */
  triggerLabel?: string;
}

/**
 * Writes and sends an email from DocCheck. A correction request is drafted in the language the
 * supplier reads, from the findings picked; the conversation opens once it is queued, and the
 * supplier's reply comes back to it.
 */
export function ComposeDialog({ mode, shipmentId, partyId, reference = '', findings = [], documents = new Map(), disabled, preselect, triggerLabel }: ComposeDialogProps) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [language, setLanguage] = useState<Locale>(locale);
  const [dictionary, setDictionary] = useState<Messages>();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [contacts, setContacts] = useState<MailContact[]>([]);
  const [logOnly, setLogOnly] = useState(false);
  const [sender, setSender] = useState<{ from?: string; replyTo?: string }>({});
  const [view, setView] = useState<'write' | 'preview'>('write');
  const [preview, setPreview] = useState<string>();
  const [error, setError] = useState<string>();
  const [sending, setSending] = useState(false);
  const request = mode === 'request';

  useEffect(() => {
    if (!open || !request) return;
    let active = true;
    void loadMessages(language).then((m) => active && setDictionary(m));
    return () => {
      active = false;
    };
  }, [open, request, language]);

  const chosen = useMemo(() => findings.filter((f) => f.fingerprint && picked.has(f.fingerprint)), [findings, picked]);
  // A new language or selection drafts the request again (edits to the previous draft are replaced).
  useEffect(() => {
    if (!request || !dictionary) return;
    const tt = (key: MessageKey, vars?: MessageVars) => translate(dictionary, language, key, vars);
    const letter = supplierLetter(tt, { reference, findings: chosen, documents });
    setSubject(letter.subject);
    setBody(letter.body);
  }, [request, dictionary, language, reference, chosen, documents]);

  // The preview is the HTML part the server sends, built from what is written now.
  useEffect(() => {
    if (!open || view !== 'preview') return;
    let active = true;
    const timer = setTimeout(() => {
      api.mailPreview({ subject, body, language: request ? language : locale }).then(
        (r) => active && setPreview(r.html),
        () => active && setPreview(undefined),
      );
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [open, view, subject, body, language, locale, request]);

  const openWith = (next: boolean) => {
    if (next) {
      setPicked(new Set(preselect ?? findings.flatMap((f) => (f.fingerprint ? [f.fingerprint] : []))));
      setLanguage(locale);
      setTo('');
      setCc('');
      setError(undefined);
      setView('write');
      if (!request) {
        setSubject(reference ? `${reference}: ` : '');
        setBody('');
      }
      api.mailContacts(partyId).then(setContacts, () => setContacts([]));
      api.mailStatus().then(
        (s) => {
          setLogOnly(s.sending === 'log');
          setSender({ from: s.from, replyTo: s.replyTo });
        },
        () => setLogOnly(false),
      );
    }
    setOpen(next);
  };

  const addContact = (email: string) => {
    const current = parseAddresses(to).addresses;
    if (!current.includes(email)) setTo([...current, email].join(', '));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const toList = parseAddresses(to);
    const ccList = parseAddresses(cc);
    const invalid = [...toList.invalid, ...ccList.invalid];
    if (invalid.length) return setError(t('mail.compose.badAddress', { address: invalid[0]! }));
    if (toList.addresses.length === 0) return setError(t('mail.compose.noRecipient'));
    setSending(true);
    setError(undefined);
    try {
      const kind: ThreadKind = request ? 'correction_request' : 'conversation';
      const thread = await api.createThread({
        kind,
        ...(shipmentId ? { shipmentId } : {}),
        ...(partyId ? { partyId } : {}),
        to: toList.addresses,
        cc: ccList.addresses,
        subject: subject.trim(),
        body: body.trim(),
        language,
        fingerprints: request ? chosen.map((f) => f.fingerprint!) : [],
      });
      refreshMailSummary();
      setOpen(false);
      window.location.hash = `#/app/inbox/${thread.id}`;
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={openWith}>
      <Dialog.Trigger asChild>
        <Button size="sm" disabled={disabled} title={disabled && request ? t('mail.compose.none') : undefined}>
          <EnvelopeClosedIcon aria-hidden /> {triggerLabel ?? (request ? t('mail.compose.requestButton') : t('mail.newMessage'))}
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog dialog-wide">
          <Dialog.Title className="dialog-title">{request ? t('mail.compose.requestTitle') : t('mail.compose.messageTitle')}</Dialog.Title>
          <Dialog.Description className="dialog-description">{t('mail.compose.requestText')}</Dialog.Description>
          <form className="stack-form" onSubmit={(e) => void submit(e)} aria-busy={sending} noValidate>
            {logOnly && (
              <div className="mail-dev-note">
                <Banner tone="warning">{t('mail.compose.logOnly')}</Banner>
              </div>
            )}
            {sender.from && (
              <dl className="compose-from">
                <dt>{t('mail.compose.from')}</dt>
                <dd>{sender.from}</dd>
                {sender.replyTo && (
                  <>
                    <dt>{t('mail.compose.replies')}</dt>
                    <dd>{sender.replyTo}</dd>
                  </>
                )}
              </dl>
            )}
            <div className="compose-row">
              <Field label={`${t('mail.compose.to')} (${t('mail.compose.toHint')})`}>
                {(id) => <TextInput id={id} type="text" inputMode="email" value={to} onChange={(e) => setTo(e.target.value)} autoComplete="off" />}
              </Field>
              <Field label={t('mail.compose.cc')}>{(id) => <TextInput id={id} type="text" inputMode="email" value={cc} onChange={(e) => setCc(e.target.value)} autoComplete="off" />}</Field>
            </div>
            {contacts.length > 0 && (
              <div className="contact-suggestions" role="group" aria-label={t('mail.compose.suggestions')}>
                <span className="muted small">{t('mail.compose.suggestions')}:</span>
                {contacts.map((c) => (
                  <Button key={c.email} size="sm" variant="ghost" onClick={() => addContact(c.email)}>
                    {c.name ? `${c.name} <${c.email}>` : c.email}
                  </Button>
                ))}
              </div>
            )}
            {request && (
              <>
                <fieldset className="fieldset">
                  <legend className="field-label">{t('mail.compose.include')}</legend>
                  <div className="supplier-picks">
                    {findings.map((f) => {
                      const key = ruleGuideKey(f.ruleId, 'problem');
                      return (
                        <Checkbox
                          key={f.fingerprint}
                          label={`${f.ruleId} · ${key ? t(key) : f.message}`}
                          checked={picked.has(f.fingerprint!)}
                          onCheckedChange={(on) =>
                            setPicked((s) => {
                              const next = new Set(s);
                              if (on) next.add(f.fingerprint!);
                              else next.delete(f.fingerprint!);
                              return next;
                            })
                          }
                        />
                      );
                    })}
                  </div>
                </fieldset>
                <Field label={t('mail.compose.language')}>
                  {(id) => <Select id={id} value={language} options={LOCALES.map((l) => ({ value: l.value, label: l.label }))} onValueChange={setLanguage} />}
                </Field>
              </>
            )}
            <Field label={t('mail.compose.subject')}>{(id) => <TextInput id={id} value={subject} maxLength={300} onChange={(e) => setSubject(e.target.value)} />}</Field>
            <div className="field">
              <div className="compose-body-head">
                <label className="field-label" htmlFor={`compose-body-${mode}`}>
                  {t('mail.compose.body')}
                </label>
                <ToggleChips
                  value={view}
                  options={[
                    { value: 'write', label: t('mail.compose.write') },
                    { value: 'preview', label: t('mail.compose.preview') },
                  ]}
                  onValueChange={setView}
                  ariaLabel={t('mail.compose.body')}
                />
              </div>
              {view === 'write' ? (
                <textarea
                  id={`compose-body-${mode}`}
                  className="input textarea compose-text"
                  rows={14}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  lang={request ? language : undefined}
                />
              ) : (
                <iframe className="compose-preview" title={t('mail.compose.previewTitle')} sandbox="" srcDoc={preview ?? ''} />
              )}
            </div>
            {error && <Banner tone="error">{error}</Banner>}
            <div className="dialog-actions">
              <Dialog.Close asChild>
                <Button>{t('common.cancel')}</Button>
              </Dialog.Close>
              <Button type="submit" variant="primary" disabled={sending || !subject.trim() || !body.trim() || (request && chosen.length === 0)}>
                {sending ? t('mail.compose.sending') : t('mail.compose.send')}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
