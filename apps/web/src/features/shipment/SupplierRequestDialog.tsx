import { EnvelopeClosedIcon } from '@radix-ui/react-icons';
import { Dialog } from 'radix-ui';
import { useEffect, useMemo, useState } from 'react';
import type { ShipmentDocument, ValidationFinding } from '../../api/types';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Checkbox } from '../../components/ui/Checkbox';
import { Field } from '../../components/ui/Field';
import { Select } from '../../components/ui/Select';
import { TextInput } from '../../components/ui/TextInput';
import type { MessageKey, MessageVars } from '../../i18n/keys';
import { loadMessages } from '../../i18n/loadMessages';
import { LOCALES, type Locale } from '../../i18n/locales';
import type { Messages } from '../../i18n/messages/en';
import { translate } from '../../i18n/translate';
import { useI18n } from '../../i18n/useI18n';
import { ruleGuideKey } from '../../lib/findingReview';
import { supplierLetter } from '../../lib/supplierLetter';

export interface SupplierRequestDialogProps {
  /** Open findings that can be asked about. */
  findings: readonly ValidationFinding[];
  documents: ReadonlyMap<string, ShipmentDocument>;
  reference: string;
  onMarkWaiting: (fingerprints: string[]) => Promise<void>;
}

/**
 * Writes the message asking the supplier for corrected documents, in the language the supplier reads.
 * It is copied or opened in the user's email: nothing is sent from here.
 */
export function SupplierRequestDialog({ findings, documents, reference, onMarkWaiting }: SupplierRequestDialogProps) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [language, setLanguage] = useState<Locale>(locale);
  const [dictionary, setDictionary] = useState<Messages>();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [recipient, setRecipient] = useState('');
  const [text, setText] = useState('');
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void loadMessages(language).then((m) => active && setDictionary(m));
    return () => {
      active = false;
    };
  }, [language]);

  const chosen = useMemo(() => findings.filter((f) => f.fingerprint && picked.has(f.fingerprint)), [findings, picked]);
  const letter = useMemo(() => {
    if (!dictionary) return undefined;
    const tt = (key: MessageKey, vars?: MessageVars) => translate(dictionary, language, key, vars);
    return supplierLetter(tt, { reference, findings: chosen, documents });
  }, [dictionary, language, reference, chosen, documents]);
  // A new language or selection rewrites the message (edits to the previous one are dropped).
  useEffect(() => {
    if (letter) setText(letter.body);
    setCopied(false);
  }, [letter]);

  const openWith = (next: boolean) => {
    if (next) {
      setPicked(new Set(findings.flatMap((f) => (f.fingerprint ? [f.fingerprint] : []))));
      setNotice(undefined);
      setLanguage(locale);
    }
    setOpen(next);
  };
  const copy = async () => {
    await navigator.clipboard.writeText(letter ? `${letter.subject}\n\n${text}` : text);
    setCopied(true);
  };
  const mailto = letter ? `mailto:${encodeURIComponent(recipient.trim())}?subject=${encodeURIComponent(letter.subject)}&body=${encodeURIComponent(text)}` : undefined;
  const markWaiting = async () => {
    setBusy(true);
    try {
      await onMarkWaiting(chosen.map((f) => f.fingerprint!));
      setNotice(t('review.supplier.marked', { count: chosen.length }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={openWith}>
      <Dialog.Trigger asChild>
        <Button size="sm" disabled={findings.length === 0} title={findings.length === 0 ? t('review.supplier.none') : undefined}>
          <EnvelopeClosedIcon aria-hidden /> {t('review.supplier.button')}
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog dialog-wide">
          <Dialog.Title className="dialog-title">{t('review.supplier.title')}</Dialog.Title>
          <Dialog.Description className="dialog-description">{t('review.supplier.text')}</Dialog.Description>
          <div className="stack-form">
            <fieldset className="fieldset">
              <legend className="field-label">{t('review.supplier.include')}</legend>
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
            <div className="setting-row">
              <Field label={t('review.supplier.language')}>
                {(id) => <Select id={id} value={language} options={LOCALES.map((l) => ({ value: l.value, label: l.label }))} onValueChange={setLanguage} />}
              </Field>
              <Field label={t('review.supplier.recipient')}>
                {(id) => <TextInput id={id} type="email" value={recipient} onChange={(e) => setRecipient(e.target.value)} autoComplete="off" />}
              </Field>
            </div>
            <Field label={t('review.supplier.message')}>
              {(id) => <textarea id={id} className="input textarea mono-text" rows={12} value={text} onChange={(e) => setText(e.target.value)} lang={language} />}
            </Field>
            {notice && <Banner tone="ok">{notice}</Banner>}
            <div className="dialog-actions">
              <Button onClick={() => void copy()} disabled={chosen.length === 0}>
                {copied ? t('review.supplier.copied') : t('review.supplier.copy')}
              </Button>
              {mailto && chosen.length > 0 && (
                <Button asChild>
                  <a href={mailto}>{t('review.supplier.mail')}</a>
                </Button>
              )}
              <Button variant="primary" onClick={() => void markWaiting()} disabled={busy || chosen.length === 0}>
                {t('review.supplier.markWaiting')}
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
