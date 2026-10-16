import type { Meter } from '../../api/usage';
import { Banner } from '../../components/ui/Banner';
import { useUsage } from '../../hooks/useUsage';
import { useI18n } from '../../i18n/useI18n';
import { usageDate } from '../../lib/usageDate';

const RANK = { ok: 0, warning: 1, over: 2, blocked: 3 } as const;

/** A warning when a meter of the plan is near or past its limit, with a link to the usage page. */
export function UsageNotice() {
  const { t, locale } = useI18n();
  const { data } = useUsage();
  if (!data) return null;
  const worst = data.meters.reduce<Meter | undefined>((w, m) => (RANK[m.state] > RANK[w?.state ?? 'ok'] ? m : w), undefined);
  if (!worst) return null;
  const kind = t(`usage.kindLower.${worst.kind}`);
  const text =
    worst.state === 'blocked'
      ? t('usage.blockedBanner', { kind, date: usageDate(data.resetsAt, locale) })
      : worst.state === 'over'
        ? t('usage.overBanner', { kind })
        : t('usage.warningBanner', { kind, percent: worst.percent ?? 0 });
  return (
    <Banner tone={worst.state === 'blocked' ? 'error' : 'warning'}>
      {text} <a href="#/app/usage">{t('usage.seeUsage')}</a>
    </Banner>
  );
}
