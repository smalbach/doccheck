import { PlusIcon } from '@radix-ui/react-icons';
import { Dialog } from 'radix-ui';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../api/client';
import { LINK_PLACEHOLDER, portalApi } from '../../api/portal';
import type { Destination, PartySummary } from '../../api/types';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Field } from '../../components/ui/Field';
import { Select } from '../../components/ui/Select';
import { TextInput } from '../../components/ui/TextInput';
import { refreshMailSummary } from '../../hooks/useMailSummary';
import type { MessageKey, MessageVars } from '../../i18n/keys';
import { loadMessages } from '../../i18n/loadMessages';
import { LOCALES, type Locale } from '../../i18n/locales';
import type { Messages } from '../../i18n/messages/en';
import { translate } from '../../i18n/translate';
import { useI18n } from '../../i18n/useI18n';
import { errorMessage } from '../../lib/errorMessage';
import { parseAddresses } from '../../lib/parseAddresses';

const OTHER = '__other__';

/**
 * Starts a pre-shipment check: a draft shipment for one supplier's documents, and an email in the
 * supplier's language with the link to upload them. The conversation opens once it is queued.
 */
export function PreShipmentDialog({ partyId, partyName }: { partyId?: string; partyName?: string }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [parties, setParties] = useState<PartySummary[]>([]);
  const [party, setParty] = useState<string>(partyId ?? OTHER);
  const [supplierName, setSupplierName] = useState('');
  const [reference, setReference] = useState('');
  const [destination, setDestination] = useState<Destination>('CA');
  const [language, setLanguage] = useState<Locale>(locale);
  const [dictionary, setDictionary] = useState<Messages>();
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string>();
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void loadMessages(language).then((m) => active && setDictionary(m));
    return () => {
      active = false;
    };
  }, [open, language]);

  // The email is drafted in the supplier's language; a new language or reference drafts it again.
  useEffect(() => {
    if (!dictionary) return;
    const tt = (key: MessageKey, vars?: MessageVars) => translate(dictionary, language, key, vars);
    const ref = reference.trim() || '…';
    setSubject(tt('portal.preSubject', { reference: ref }));
    setBody([tt('portal.preBody', { reference: ref }), '', tt('portal.preLine'), LINK_PLACEHOLDER, '', tt('portal.preClosing')].join('\n'));
  }, [dictionary, language, reference]);

  const openWith = (next: boolean) => {
    if (next) {
      setParty(partyId ?? OTHER);
      setSupplierName('');
      setReference('');
      setLanguage(locale);
      setTo('');
      setError(undefined);
      if (!partyId) api.insightsParties({ role: 'supplier', limit: 100 }).then((r) => setParties(r.items), () => setParties([]));
      // The address the company's documents came from is the default recipient.
      if (partyId) api.mailContacts(partyId).then((list) => setTo((current) => current || list[0]?.email || ''), () => undefined);
    }
    setOpen(next);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const toList = parseAddresses(to);
    if (toList.invalid.length) return setError(t('mail.compose.badAddress', { address: toList.invalid[0]! }));
    if (toList.addresses.length === 0) return setError(t('mail.compose.noRecipient'));
    setSending(true);
    setError(undefined);
    try {
      const created = await portalApi.createPreShipment({
        ...(party !== OTHER ? { partyId: party } : { supplierName: supplierName.trim() }),
        reference: reference.trim(),
        destination,
        language,
        to: toList.addresses,
        cc: [],
        subject: subject.trim(),
        body: body.trim(),
      });
      refreshMailSummary();
      setOpen(false);
      if (created.threadId) window.location.hash = `#/app/inbox/${created.threadId}`;
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  const partyOptions = [...(partyId ? [{ value: partyId, label: partyName ?? partyId }] : parties.map((p) => ({ value: p.id, label: p.name }))), { value: OTHER, label: t('portal.preSupplierNone') }];
  const ready = reference.trim() && subject.trim() && body.trim() && (party !== OTHER || supplierName.trim());
  return (
    <Dialog.Root open={open} onOpenChange={openWith}>
      <Dialog.Trigger asChild>
        <Button size="sm">
          <PlusIcon aria-hidden /> {t('portal.preNew')}
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog dialog-wide">
          <Dialog.Title className="dialog-title">{t('portal.preNew')}</Dialog.Title>
          <Dialog.Description className="dialog-description">{t('portal.preDialogText')}</Dialog.Description>
          <form className="stack-form" onSubmit={(e) => void submit(e)} aria-busy={sending} noValidate>
            <div className="compose-row">
              <Field label={t('portal.preSupplier')}>{(id) => <Select id={id} value={party} options={partyOptions} onValueChange={setParty} disabled={!!partyId} />}</Field>
              {party === OTHER && <Field label={t('portal.preSupplierName')}>{(id) => <TextInput id={id} value={supplierName} maxLength={200} onChange={(e) => setSupplierName(e.target.value)} />}</Field>}
            </div>
            <div className="compose-row">
              <Field label={t('portal.preReference')}>{(id) => <TextInput id={id} value={reference} maxLength={120} onChange={(e) => setReference(e.target.value)} />}</Field>
              <Field label={t('portal.preDestination')}>
                {(id) => (
                  <Select
                    id={id}
                    value={destination}
                    options={[
                      { value: 'CA', label: t('destinations.CA') },
                      { value: 'US', label: t('destinations.US') },
                    ]}
                    onValueChange={setDestination}
                  />
                )}
              </Field>
            </div>
            <div className="compose-row">
              <Field label={`${t('mail.compose.to')} (${t('mail.compose.toHint')})`}>
                {(id) => <TextInput id={id} type="text" inputMode="email" value={to} onChange={(e) => setTo(e.target.value)} autoComplete="off" />}
              </Field>
              <Field label={t('portal.preLanguage')}>{(id) => <Select id={id} value={language} options={LOCALES.map((l) => ({ value: l.value, label: l.label }))} onValueChange={setLanguage} />}</Field>
            </div>
            <Field label={t('mail.compose.subject')}>{(id) => <TextInput id={id} value={subject} maxLength={300} onChange={(e) => setSubject(e.target.value)} />}</Field>
            <Field label={t('mail.compose.body')}>
              {(id) => <textarea id={id} className="input textarea compose-text" rows={10} value={body} onChange={(e) => setBody(e.target.value)} lang={language} />}
            </Field>
            {error && <Banner tone="error">{error}</Banner>}
            <div className="dialog-actions">
              <Dialog.Close asChild>
                <Button>{t('common.cancel')}</Button>
              </Dialog.Close>
              <Button type="submit" variant="primary" disabled={sending || !ready}>
                {sending ? t('portal.creating') : t('portal.create')}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
