import type { DutyEstimate, LineEstimate } from '../../api/dutyTypes';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Tag } from '../../components/ui/Tag';
import { useI18n } from '../../i18n/useI18n';
import { addCents } from '../../lib/addCents';

/** Per invoice line: tariff number, treatment, rate, value, duty, additional duties, fees and taxes, landed cost. */
export function DutyLinesTable({ estimate }: { estimate: DutyEstimate }) {
  const { t, formatMoney } = useI18n();
  const m = (v: string | undefined) => (v === undefined ? <span className="muted">{t('duties.lines.notComputed')}</span> : formatMoney(v, estimate.currency));
  const columns: Column<LineEstimate>[] = [
    { key: 'line', header: t('duties.lines.line'), cell: (l) => l.lineNo, numeric: true },
    {
      key: 'goods',
      header: t('duties.lines.goods'),
      cell: (l) => (
        <>
          {l.description}
          {l.adcvd.length > 0 && (
            <>
              <br />
              <Tag tone="accent">{t('duties.lines.adcvd', { cases: l.adcvd.join(', ') })}</Tag>
            </>
          )}
        </>
      ),
    },
    {
      key: 'tariff',
      header: t('duties.lines.tariff'),
      cell: (l) =>
        l.tariff ? (
          <>
            <code>{l.tariff.classification ?? l.tariff.code}</code>
            {l.tariff.match === 'several' && (
              <>
                <br />
                <span className="small muted">{t('duties.lines.highest', { count: l.tariff.candidates?.length ?? 0 })}</span>
              </>
            )}
          </>
        ) : (
          <code>{l.hsInput ?? '—'}</code>
        ),
    },
    { key: 'origin', header: t('duties.lines.origin'), cell: (l) => l.origin ?? '—', secondary: true },
    { key: 'treatment', header: t('duties.lines.treatment'), cell: (l) => (l.treatment.code === 'general' ? t('duties.lines.general') : l.treatment.code), secondary: true },
    { key: 'rate', header: t('duties.lines.rate'), cell: (l) => l.rate ?? '—' },
    { key: 'value', header: t('duties.lines.value'), cell: (l) => m(l.dutiableValue), numeric: true },
    { key: 'duty', header: t('duties.lines.duty'), cell: (l) => m(l.duty), numeric: true },
    {
      key: 'additional',
      header: t('duties.lines.additional'),
      numeric: true,
      cell: (l) => (
        <>
          {m(l.additionalTotal)}
          {l.additional.some((a) => !a.verified) && (
            <>
              <br />
              <span className="small muted">{t('duties.lines.toConfirm')}</span>
            </>
          )}
        </>
      ),
    },
    { key: 'feesTaxes', header: t('duties.lines.feesTaxes'), cell: (l) => m(addCents(l.fees, l.taxes)), numeric: true, secondary: true },
    { key: 'landed', header: t('duties.lines.landed'), cell: (l) => m(l.landedCost), numeric: true },
  ];
  return <DataTable caption={t('duties.lines.caption')} columns={columns} rows={estimate.lines} rowKey={(l) => String(l.lineNo)} compact />;
}

