import { useState, type FormEvent } from 'react';
import type { ThreadDetail } from '../../api/types';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Field } from '../../components/ui/Field';
import { TextInput } from '../../components/ui/TextInput';
import { useI18n } from '../../i18n/useI18n';
import { parseAddresses } from '../../lib/parseAddresses';

export interface ReplyBoxProps {
  thread: ThreadDetail;
  onSend: (body: string, to: string[]) => Promise<void>;
}

/** Answers in the conversation, by default to whoever wrote last. */
export function ReplyBox({ thread, onSend }: ReplyBoxProps) {
  const { t } = useI18n();
  const lastIn = [...thread.items].reverse().find((m) => m.direction === 'in');
  const firstOut = thread.items.find((m) => m.direction === 'out');
  const [to, setTo] = useState((lastIn ? [lastIn.from] : (firstOut?.to ?? [])).join(', '));
  const [body, setBody] = useState('');
  const [error, setError] = useState<string>();
  const [sending, setSending] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const { addresses, invalid } = parseAddresses(to);
    if (invalid.length) return setError(t('mail.compose.badAddress', { address: invalid[0]! }));
    if (addresses.length === 0) return setError(t('mail.compose.noRecipient'));
    setSending(true);
    setError(undefined);
    try {
      await onSend(body.trim(), addresses);
      setBody('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };
  return (
    <form className="stack-form reply-box" onSubmit={(e) => void submit(e)} aria-label={t('mail.replyTitle')}>
      <Field label={t('mail.replyTo')}>{(id) => <TextInput id={id} value={to} onChange={(e) => setTo(e.target.value)} autoComplete="off" />}</Field>
      <Field label={t('mail.replyTitle')}>{(id) => <textarea id={id} className="input textarea" rows={5} value={body} onChange={(e) => setBody(e.target.value)} />}</Field>
      {error && <Banner tone="error">{error}</Banner>}
      <div>
        <Button type="submit" variant="primary" disabled={sending || body.trim().length === 0}>
          {sending ? t('mail.sending') : t('mail.send')}
        </Button>
      </div>
    </form>
  );
}
