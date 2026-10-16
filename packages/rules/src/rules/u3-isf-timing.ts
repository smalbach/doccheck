import { daysBetween, hasTime, instant } from '../reference';
import type { Rule } from '../types';

/**
 * U3 (US ocean): the ISF was filed at least 24 hours before the cargo was laden on the vessel
 * (19 CFR 149.2(b)). Loading is the ISF's estimated loading date or, when it has none, the BL
 * shipped-on-board date. With dates only, a filing on or after the day of loading is late for sure;
 * one the day before may or may not be, and is not flagged. CBP can claim liquidated damages of
 * USD 5,000 per late filing (19 CFR 113.62, 113.64).
 */
export const u3IsfTiming: Rule = {
  definition: {
    id: 'U3',
    title: 'ISF filed at least 24 hours before loading',
    appliesTo: ['US'],
    requires: ['ISF'],
    kind: 'DETERMINISTIC',
    severity: 'HIGH',
    params: [{ key: 'isfLeadHours', unit: 'hours', min: 0, max: 168 }],
  },
  run(ctx, params) {
    if (!ctx.isf?.data.filedAt) return [];
    const filed = ctx.isf.data.filedAt;
    const fromIsf = ctx.isf.data.estimatedLoadingDate;
    const loading = fromIsf ?? ctx.billOfLading?.data.shippedOnBoardDate;
    if (!loading) return [];
    const loadingEvidence = fromIsf
      ? { documentId: ctx.isf.id, field: 'estimatedLoadingDate', value: fromIsf }
      : { documentId: ctx.billOfLading!.id, field: 'shippedOnBoardDate', value: loading };
    const lead = params.isfLeadHours;
    const exact = hasTime(filed) && hasTime(loading);
    // Without both times, compare calendar days.
    const hours = exact ? (instant(loading) - instant(filed)) / 3_600_000 : daysBetween(loading, filed) * 24;
    // Dates only: a filing at most ceil(lead / 24) - 1 days before loading is late at any time of day
    // (for 24 hours: filed on or after the day of loading).
    const late = exact ? hours < lead : hours <= (Math.ceil(lead / 24) - 1) * 24;
    if (!late) return [];
    const when = exact
      ? hours < 0 ? `${Math.round(-hours)} hours after loading` : `only ${Math.round(hours * 10) / 10} hours before loading`
      : hours < 0 ? `${Math.round(-hours / 24)} day(s) after loading` : hours === 0 ? 'on the day of loading' : `${Math.round(hours / 24)} day(s) before loading`;
    return [
      {
        message: `The ISF was filed ${filed}, ${when} (${loading}); it must be filed at least ${lead} hours before the cargo is laden (19 CFR 149.2(b)). A late ISF can cost USD 5,000 in liquidated damages.`,
        evidence: [{ documentId: ctx.isf.id, field: 'filedAt', value: filed }, loadingEvidence],
        suggestedFix: 'File ISFs when the booking is confirmed, not at loading; record why this one was late in case CBP issues a claim.',
      },
    ];
  },
};
