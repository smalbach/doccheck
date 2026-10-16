import type { AllowlistItem } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Tag } from '../../components/ui/Tag';
import { useI18n } from '../../i18n/useI18n';

export interface AllowlistTableProps {
  items: readonly AllowlistItem[];
  /** Adds the account column (an admin looking at every account). */
  showAccount?: boolean;
  readOnly: boolean;
  onRemove: (item: AllowlistItem) => void;
}

/** Matches set aside, with who did it, when and why; removed ones show who put them back. */
export function AllowlistTable({ items, showAccount, readOnly, onRemove }: AllowlistTableProps) {
  const { t, formatDateTime } = useI18n();
  const columns: Column<AllowlistItem>[] = [
    { key: 'party', header: t('screening.allowlist.columns.party'), cell: (a) => a.partyName },
    {
      key: 'entry',
      header: t('screening.allowlist.columns.entry'),
      cell: (a) => (
        <>
          {a.entryName}
          <div className="muted small mono">
            {a.list} · {a.entryId}
          </div>
        </>
      ),
    },
    ...(showAccount ? [{ key: 'account', header: t('screening.allowlist.columns.account'), cell: (a: AllowlistItem) => a.account }] : []),
    { key: 'reason', header: t('screening.allowlist.columns.reason'), cell: (a) => a.reason },
    {
      key: 'added',
      header: t('screening.allowlist.columns.added'),
      cell: (a) => <span className="muted">{t('screening.allowlist.by', { who: a.createdBy ?? '—', date: formatDateTime(a.createdAt) })}</span>,
      secondary: true,
    },
    {
      key: 'status',
      header: t('screening.allowlist.columns.status'),
      cell: (a) =>
        a.removedAt ? (
          <span className="muted small">
            {t('screening.allowlist.removedBy', { who: a.removedBy ?? '—', date: formatDateTime(a.removedAt) })}
            {a.removedReason && <> · {a.removedReason}</>}
          </span>
        ) : (
          <Tag tone="accent">{t('screening.allowlist.active')}</Tag>
        ),
    },
    {
      key: 'actions',
      header: <span className="visually-hidden">{t('screening.allowlist.columns.actions')}</span>,
      cell: (a) =>
        a.removedAt ? null : (
          <ConfirmDialog
            trigger={
              <Button size="sm" disabled={readOnly} aria-label={`${t('screening.allowlist.remove')} · ${a.partyName}`}>
                {t('screening.allowlist.remove')}
              </Button>
            }
            title={t('screening.allowlist.removeTitle')}
            description={t('screening.allowlist.removeText', { party: a.partyName, entry: a.entryName })}
            confirmLabel={t('screening.allowlist.remove')}
            onConfirm={() => onRemove(a)}
          />
        ),
    },
  ];
  return <DataTable columns={columns} rows={items} rowKey={(a) => a.id} caption={t('screening.allowlist.title')} compact />;
}
