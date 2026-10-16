import { useEffect, useId, useState, type FormEvent } from 'react';
import { teamApi } from '../../api/teamClient';
import type { Comment, CommentTargetKind, Member } from '../../api/teamTypes';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Select';
import { useI18n } from '../../i18n/useI18n';
import { errorMessage } from '../../lib/errorMessage';
import { useAuth } from '../auth/useAuth';
import { useOrg } from './useOrg';

export interface CommentsThreadProps {
  shipmentId: string;
  targetKind: CommentTargetKind;
  targetId: string;
  members: Member[];
  /** After a comment is added or removed (comment counts change). */
  onChange?: () => void;
}

const NO_MENTION = '__none';

/**
 * The comments on one target (the shipment, a finding or a document), oldest first, and a box to add
 * one. "Mention" picks a member: "@Name" goes into the text and they are notified.
 */
export function CommentsThread({ shipmentId, targetKind, targetId, members, onChange }: CommentsThreadProps) {
  const { t, formatDateTime } = useI18n();
  const { user } = useAuth();
  const { can } = useOrg();
  const [comments, setComments] = useState<Comment[]>();
  const [body, setBody] = useState('');
  const [mentions, setMentions] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const textId = useId();
  const canWrite = can('comment.write');
  const canModerate = can('members.manage');

  useEffect(() => {
    let active = true;
    teamApi.comments(shipmentId, targetKind, targetId).then(
      (c) => active && setComments(c),
      (err: unknown) => active && setError(errorMessage(err)),
    );
    return () => {
      active = false;
    };
  }, [shipmentId, targetKind, targetId]);

  const mention = (userId: string) => {
    const m = members.find((x) => x.userId === userId);
    if (!m) return;
    setBody((b) => `${b}${b && !b.endsWith(' ') ? ' ' : ''}@${m.name} `);
    setMentions((ids) => (ids.includes(userId) ? ids : [...ids, userId]));
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      // Only names still in the text count as mentions.
      const kept = mentions.filter((id) => body.includes(`@${members.find((m) => m.userId === id)?.name}`));
      setComments(await teamApi.addComment(shipmentId, { targetKind, targetId, body: body.trim(), mentions: kept }));
      setBody('');
      setMentions([]);
      onChange?.();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const remove = (c: Comment) =>
    void teamApi.deleteComment(shipmentId, c.id).then(
      () => {
        setComments((list) => list?.map((x) => (x.id === c.id ? { ...x, deleted: true, body: '', mentions: [] } : x)));
        onChange?.();
      },
      (err: unknown) => setError(errorMessage(err)),
    );

  const mentionable = members.filter((m) => m.userId !== user?.id);
  return (
    <div className="comments">
      {error && <Banner tone="error">{error}</Banner>}
      {comments && comments.length === 0 && <p className="muted small">{t('team.comments.none')}</p>}
      {comments && comments.length > 0 && (
        <ol className="comment-list">
          {comments.map((c) => (
            <li key={c.id} className="comment">
              <p className="comment-meta small">
                <strong>{c.author?.name ?? t('review.someone')}</strong> <span className="muted">· {formatDateTime(c.createdAt)}</span>
                {c.editedAt && <span className="muted"> · {t('team.comments.edited')}</span>}
              </p>
              {c.deleted ? <p className="muted small">{t('team.comments.deleted')}</p> : <p className="comment-body">{c.body}</p>}
              {!c.deleted && (c.author?.id === user?.id || canModerate) && (
                <Button size="sm" variant="link" onClick={() => remove(c)} aria-label={t('team.comments.deleteOne', { name: c.author?.name ?? '' })}>
                  {t('team.comments.delete')}
                </Button>
              )}
            </li>
          ))}
        </ol>
      )}
      {canWrite && (
        <form className="comment-form" onSubmit={(e) => void submit(e)}>
          <label htmlFor={textId} className="field-label">
            {t('team.comments.add')}
          </label>
          <textarea id={textId} className="input comment-input" rows={2} maxLength={5000} required value={body} onChange={(e) => setBody(e.target.value)} />
          <div className="setting-row">
            {mentionable.length > 0 && (
              <Select<string>
                value={NO_MENTION}
                options={[{ value: NO_MENTION, label: t('team.comments.mention') }, ...mentionable.map((m) => ({ value: m.userId, label: m.name }))]}
                onValueChange={(v) => v !== NO_MENTION && mention(v)}
                ariaLabel={t('team.comments.mention')}
              />
            )}
            <Button type="submit" variant="primary" size="sm" disabled={busy || !body.trim()}>
              {busy ? t('common.saving') : t('team.comments.post')}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
