import { useEffect, useState } from 'react';
import type { ShipmentDocument } from '../../api/types';
import { teamApi } from '../../api/teamClient';
import { Banner } from '../../components/ui/Banner';
import { Card } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { Select } from '../../components/ui/Select';
import { Switch } from '../../components/ui/Switch';
import { Tag } from '../../components/ui/Tag';
import { TextInput } from '../../components/ui/TextInput';
import { useI18n } from '../../i18n/useI18n';
import { errorMessage } from '../../lib/errorMessage';
import { CommentsThread } from './CommentsThread';
import { useShipmentCollab } from './ShipmentCollabContext';
import { useOrg } from './useOrg';

const UNASSIGNED = '__none';
const SHIPMENT = '__shipment';

/** Teamwork on the shipment: who owns it, its ETA and due date, who it is shared with, and comments. */
export function ShipmentCollabCard({ documents }: { documents: readonly ShipmentDocument[] }) {
  const { t, formatDateTime } = useI18n();
  const { can } = useOrg();
  const ctx = useShipmentCollab();
  const [eta, setEta] = useState('');
  const [due, setDue] = useState('');
  const [target, setTarget] = useState(SHIPMENT);
  const [shares, setShares] = useState<string[]>();
  const [error, setError] = useState<string>();
  const collab = ctx?.collab;
  const canShare = can('members.manage');
  const shipmentId = ctx?.shipmentId;
  useEffect(() => {
    setEta(collab?.eta ?? '');
    setDue(collab?.manualDueAt ? collab.manualDueAt.slice(0, 10) : '');
  }, [collab?.eta, collab?.manualDueAt]);
  useEffect(() => {
    if (!canShare || !shipmentId) return;
    teamApi.shares(shipmentId).then((s) => setShares(s.map((x) => x.userId)), () => undefined);
  }, [canShare, shipmentId]);
  if (!ctx || !collab) return null;
  const { members, setCollab, refresh } = ctx;
  const sid = ctx.shipmentId;
  const run = (p: Promise<typeof collab>) =>
    void p.then(
      (c) => {
        setCollab(c);
        setError(undefined);
      },
      (err: unknown) => setError(errorMessage(err)),
    );
  const clients = members.filter((m) => m.role === 'client');
  const write = can('shipment.write');

  return (
    <Card
      title={t('team.shipment.title')}
      aside={
        collab.due && (
          <Tag tone={new Date(collab.due.at) < new Date() ? 'accent' : 'neutral'}>
            {t('team.shipment.due', { date: formatDateTime(collab.due.at), source: t(`team.dueSources.${collab.due.source}`) })}
          </Tag>
        )
      }
    >
      {error && <Banner tone="error">{error}</Banner>}
      <div className="setting-row">
        <Field label={t('team.assign.shipment')}>
          {(id) =>
            can('assign') ? (
              <Select<string>
                id={id}
                value={collab.assignee?.id ?? UNASSIGNED}
                options={[{ value: UNASSIGNED, label: t('team.assign.nobody') }, ...members.filter((m) => m.role !== 'client' && m.role !== 'viewer').map((m) => ({ value: m.userId, label: m.name }))]}
                onValueChange={(v) => run(teamApi.assign(sid, v === UNASSIGNED ? null : v))}
              />
            ) : (
              <span id={id}>{collab.assignee?.name ?? t('team.assign.nobody')}</span>
            )
          }
        </Field>
        <Field label={t('team.shipment.eta')}>
          {(id) => <TextInput id={id} type="date" value={eta} disabled={!write} onChange={(e) => setEta(e.target.value)} onBlur={() => eta !== (collab.eta ?? '') && run(teamApi.schedule(sid, { eta: eta || null }))} />}
        </Field>
        <Field label={t('team.shipment.dueBy')}>
          {(id) => (
            <TextInput
              id={id}
              type="date"
              value={due}
              disabled={!write}
              onChange={(e) => setDue(e.target.value)}
              onBlur={() => due !== (collab.manualDueAt?.slice(0, 10) ?? '') && run(teamApi.schedule(sid, { dueAt: due ? `${due}T23:59:59Z` : null }))}
            />
          )}
        </Field>
      </div>
      <p className="muted small">{t('team.shipment.dueHelp')}</p>
      {canShare && clients.length > 0 && shares && (
        <fieldset className="fieldset">
          <legend>{t('team.shipment.shareWith')}</legend>
          <div className="checkbox-row">
            {clients.map((c) => (
              <Switch
                key={c.userId}
                label={c.name}
                checked={shares.includes(c.userId)}
                onCheckedChange={(on) =>
                  void (on ? teamApi.share(sid, c.userId) : teamApi.unshare(sid, c.userId)).then(
                    (s) => setShares(s.map((x) => x.userId)),
                    (err: unknown) => setError(errorMessage(err)),
                  )
                }
              />
            ))}
          </div>
        </fieldset>
      )}
      {can('data.read') && (
        <>
          <h3 className="section-title">{t('team.comments.title')}</h3>
          <Select<string>
            value={target}
            options={[
              { value: SHIPMENT, label: t('team.comments.onShipment', { count: collab.commentCounts['shipment:'] ?? 0 }) },
              ...documents.map((d) => ({ value: d.id, label: t('team.comments.onDocument', { name: d.fileName, count: collab.commentCounts[`document:${d.id}`] ?? 0 }) })),
            ]}
            onValueChange={setTarget}
            ariaLabel={t('team.comments.target')}
          />
          <CommentsThread
            key={target}
            shipmentId={sid}
            targetKind={target === SHIPMENT ? 'shipment' : 'document'}
            targetId={target === SHIPMENT ? '' : target}
            members={members}
            onChange={refresh}
          />
        </>
      )}
      {!can('data.read') && collab.assignee && <p className="small">{t('team.assign.assignedTo', { name: collab.assignee.name })}</p>}
    </Card>
  );
}
