import { useState } from 'react';
import { teamApi } from '../../api/teamClient';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Disclosure } from '../../components/ui/Disclosure';
import { Select } from '../../components/ui/Select';
import { Tag } from '../../components/ui/Tag';
import { TextInput } from '../../components/ui/TextInput';
import { useI18n } from '../../i18n/useI18n';
import { errorMessage } from '../../lib/errorMessage';
import { useAuth } from '../auth/useAuth';
import { CommentsThread } from './CommentsThread';
import { useShipmentCollab } from './ShipmentCollabContext';
import { useOrg } from './useOrg';

const UNASSIGNED = '__none';
const WORKS_ON_FINDINGS = ['owner', 'admin', 'analyst', 'reviewer'];

/**
 * Under a finding: who works it, a decision waiting for approval (with approve and reject for
 * reviewers who did not ask), and its comments. Nothing outside a shipment page.
 */
export function FindingCollab({ fingerprint, ruleId }: { fingerprint?: string; ruleId: string }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const { can } = useOrg();
  const ctx = useShipmentCollab();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string>();
  if (!ctx?.collab || !fingerprint) return null;
  const { collab, members, shipmentId, setCollab, refresh } = ctx;
  const assignee = collab.findingAssignees[fingerprint];
  const pending = collab.pendingApprovals.find((r) => r.fingerprint === fingerprint);
  const comments = collab.commentCounts[`finding:${fingerprint}`] ?? 0;
  const run = (p: Promise<typeof collab>) =>
    void p.then(
      (c) => {
        setCollab(c);
        setError(undefined);
      },
      (err: unknown) => setError(errorMessage(err)),
    );

  return (
    <div className="finding-collab">
      {error && <Banner tone="error">{error}</Banner>}
      {pending && (
        <div className="approval-pending">
          <Tag tone="accent">{t('team.approvals.pending', { status: t(`review.status.${pending.status}`) })}</Tag>
          <span className="small">
            {t('team.approvals.askedBy', { name: pending.requestedBy?.name ?? t('review.someone') })}: “{pending.note}”
          </span>
          {can('finding.approve') && pending.requestedBy?.id !== user?.id && (
            <div className="setting-row">
              <TextInput value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('team.approvals.notePlaceholder')} aria-label={t('team.approvals.noteLabel', { rule: ruleId })} />
              <Button size="sm" variant="primary" onClick={() => run(teamApi.decideApproval(shipmentId, pending.id, 'approved', note || undefined).finally(refresh))}>
                {t('team.approvals.approve')}
              </Button>
              <Button size="sm" onClick={() => run(teamApi.decideApproval(shipmentId, pending.id, 'rejected', note || undefined))}>
                {t('team.approvals.reject')}
              </Button>
            </div>
          )}
        </div>
      )}
      <div className="setting-row">
        {can('assign') ? (
          <Select<string>
            value={assignee?.id ?? UNASSIGNED}
            options={[
              { value: UNASSIGNED, label: t('team.assign.nobody') },
              ...members.filter((m) => WORKS_ON_FINDINGS.includes(m.role)).map((m) => ({ value: m.userId, label: m.name })),
            ]}
            onValueChange={(v) => run(teamApi.assignFindings(shipmentId, [fingerprint], v === UNASSIGNED ? null : v))}
            ariaLabel={t('team.assign.finding', { rule: ruleId })}
          />
        ) : (
          assignee && <span className="small">{t('team.assign.assignedTo', { name: assignee.name })}</span>
        )}
      </div>
      {can('data.read') && (
        <Disclosure summary={t('team.comments.count', { count: comments })}>
          <CommentsThread shipmentId={shipmentId} targetKind="finding" targetId={fingerprint} members={members} onChange={refresh} />
        </Disclosure>
      )}
    </div>
  );
}
