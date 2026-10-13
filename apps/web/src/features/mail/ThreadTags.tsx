import type { ThreadSummary } from '../../api/types';
import { Tag } from '../../components/ui/Tag';
import { useI18n } from '../../i18n/useI18n';

/** Status of a conversation, and what needs a look: unread, overdue, not sent. */
export function ThreadTags({ thread }: { thread: ThreadSummary }) {
  const { t } = useI18n();
  return (
    <span className="tag-list">
      <Tag tone={thread.status === 'replied' ? 'accent' : thread.status === 'closed' ? 'neutral' : 'ok'}>{t(`mail.status.${thread.status}`)}</Tag>
      {thread.unread > 0 && <Tag tone="accent">{t('mail.unread', { count: thread.unread })}</Tag>}
      {thread.overdue && <Tag>{t('mail.overdue')}</Tag>}
      {thread.failed && <Tag>{t('mail.failedTag')}</Tag>}
    </span>
  );
}
