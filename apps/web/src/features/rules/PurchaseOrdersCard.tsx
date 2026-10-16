import { useId, useRef, useState, type FormEvent } from 'react';
import { api } from '../../api/client';
import type { PurchaseOrderSummary } from '../../api/types';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { useI18n } from '../../i18n/useI18n';
import { errorMessage } from '../../lib/errorMessage';

export interface PurchaseOrdersCardProps {
  orders: PurchaseOrderSummary[];
  onChange: (orders: PurchaseOrderSummary[]) => void;
}

/** Purchase orders imported from CSV or JSON, for the three-way match (rule X24). */
export function PurchaseOrdersCard({ orders, onChange }: PurchaseOrdersCardProps) {
  const { t, formatDateTime } = useI18n();
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ tone: 'ok' | 'error'; text: string }>();

  const run = async (call: () => Promise<string>) => {
    setBusy(true);
    setStatus(undefined);
    try {
      setStatus({ tone: 'ok', text: await call() });
    } catch (err) {
      setStatus({ tone: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  const upload = (e: FormEvent) => {
    e.preventDefault();
    if (!file) return;
    void run(async () => {
      const result = await api.importPurchaseOrders(file);
      onChange(result.orders);
      setFile(undefined);
      if (input.current) input.current.value = '';
      return t('ruleSettings.po.imported', { created: result.created, updated: result.updated });
    });
  };

  const remove = (o: PurchaseOrderSummary) =>
    void run(async () => {
      await api.deletePurchaseOrder(o.id);
      onChange(orders.filter((x) => x.id !== o.id));
      return t('ruleSettings.po.deleted', { po: o.poNumber });
    });

  const columns: Column<PurchaseOrderSummary>[] = [
    { key: 'po', header: t('ruleSettings.po.columns.po'), cell: (o) => <strong>{o.poNumber}</strong> },
    { key: 'seller', header: t('ruleSettings.po.columns.seller'), cell: (o) => o.sellerName ?? t('common.none'), secondary: true },
    { key: 'lines', header: t('ruleSettings.po.columns.lines'), cell: (o) => o.lines, numeric: true },
    { key: 'currency', header: t('ruleSettings.po.columns.currency'), cell: (o) => o.currency ?? t('common.none'), secondary: true },
    { key: 'source', header: t('ruleSettings.po.columns.source'), cell: (o) => <span className="muted small">{o.source ?? t('common.none')}</span>, secondary: true },
    { key: 'updated', header: t('ruleSettings.po.columns.updated'), cell: (o) => <span className="nowrap">{formatDateTime(o.updatedAt)}</span>, secondary: true },
    {
      key: 'actions',
      header: <span className="visually-hidden">{t('ruleSettings.po.columns.actions')}</span>,
      cell: (o) => (
        <Button size="sm" variant="danger" onClick={() => remove(o)} disabled={busy} aria-label={t('ruleSettings.po.delete', { po: o.poNumber })}>
          {t('ruleSettings.po.deleteShort')}
        </Button>
      ),
    },
  ];

  return (
    <Card title={t('ruleSettings.po.title')}>
      <p className="muted">{t('ruleSettings.po.text')}</p>
      <p className="muted small">
        {t('ruleSettings.po.format')} <code>PO Number, Line, SKU, Description, Qty, UOM, Unit Price, Currency</code>
      </p>
      {status && <Banner tone={status.tone}>{status.text}</Banner>}
      <form className="rule-settings-upload" onSubmit={upload} aria-busy={busy}>
        <label htmlFor={inputId} className="field-label">
          {t('ruleSettings.po.file')}
        </label>
        <input id={inputId} ref={input} type="file" accept=".csv,.json,text/csv,application/json" onChange={(e) => setFile(e.target.files?.[0])} disabled={busy} />
        <Button type="submit" disabled={busy || !file}>
          {t('ruleSettings.po.upload')}
        </Button>
      </form>
      {orders.length > 0 ? <DataTable columns={columns} rows={orders} rowKey={(o) => o.id} caption={t('ruleSettings.po.caption')} compact /> : <p className="muted">{t('ruleSettings.po.none')}</p>}
    </Card>
  );
}
