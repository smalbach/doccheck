import { useState } from 'react';
import { api } from '../../api/client';
import type { MailMessage } from '../../api/types';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Disclosure } from '../../components/ui/Disclosure';
import { TextInput } from '../../components/ui/TextInput';
import { refreshMailSummary } from '../../hooks/useMailSummary';
import { useQuery } from '../../hooks/useQuery';
import { useI18n } from '../../i18n/useI18n';
import { errorMessage } from '../../lib/errorMessage';

const THREAD_ID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

/** Admins: received mail that answers no conversation, to assign by pasting the conversation's link. */
export function UnassignedMail({ count }: { count: number }) {
  const { t, formatDateTime } = useI18n();
  const [version, setVersion] = useState(0);
  const { data } = useQuery(`unassigned:${count}:${version}`, () => api.unassignedMail());
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const assign = async (m: MailMessage) => {
    const threadId = THREAD_ID.exec(targets[m.id] ?? '')?.[1];
    if (!threadId) return setError(t('mail.unassigned.badThread'));
    try {
      await api.assignMessage(m.id, threadId);
      setError(undefined);
      setVersion((v) => v + 1);
      refreshMailSummary();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <Card title={`${t('mail.unassigned.title')} (${count})`}>
      <p className="muted small">{t('mail.unassigned.text')}</p>
      {error && <Banner tone="error">{error}</Banner>}
      {!data || data.length === 0 ? (
        <p className="muted">{t('mail.unassigned.none')}</p>
      ) : (
        <ul className="unassigned-list">
          {data.map((m) => (
            <li key={m.id}>
              <Disclosure
                summary={
                  <span>
                    <strong>{m.from}</strong> · {m.subject || '—'} <span className="muted small">{formatDateTime(m.receivedAt ?? m.createdAt)}</span>
                  </span>
                }
              >
                <div className="mail-body">{m.text}</div>
                {m.attachments.length > 0 && (
                  <p className="small">
                    {m.attachments.map((a) => (
                      <a key={a.id} href={api.attachmentUrl(a.id)} target="_blank" rel="noopener noreferrer" className="attachment-inline">
                        {a.filename}
                      </a>
                    ))}
                  </p>
                )}
              </Disclosure>
              <div className="assign-row">
                <TextInput
                  value={targets[m.id] ?? ''}
                  onChange={(e) => setTargets((x) => ({ ...x, [m.id]: e.target.value }))}
                  placeholder={t('mail.unassigned.thread')}
                  aria-label={t('mail.unassigned.thread')}
                />
                <Button size="sm" onClick={() => void assign(m)}>
                  {t('mail.unassigned.assign')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
