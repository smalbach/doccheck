import type { I18nState } from '../../i18n/I18nContext';
import type { RunGroup } from './groupRuns';

/** What the API told us about the shipment of a group, fetched when it is shown. */
export interface GroupInfo {
  reference?: string;
  /** File name per document id. */
  fileNames: Readonly<Record<string, string>>;
  /** Validations: critical findings of the run, when known. */
  critical?: number;
}

export interface NotificationText {
  title: string;
  /** The error of a failed run. */
  body?: string;
  /** Name of the shipment, for the action's label. */
  shipment: string;
}

/** "CA-014: invoice.pdf extracted", "3 documents of CA-014 extracted", "US-007 validated: 3 findings (1 critical)". */
export function notificationText(group: RunGroup, info: GroupInfo, t: I18nState['t']): NotificationText {
  const shipment = info.reference ?? t('shipment.untitled', { id: group.shipmentId.slice(0, 8) });
  const last = group.runs[group.runs.length - 1];
  const count = group.runs.length;
  const file = (last?.documentId && info.fileNames[last.documentId]) || t('notify.document');
  const error = last?.error ? { body: last.error } : {};
  switch (group.outcome) {
    case 'extracted':
      return { shipment, title: count > 1 ? t('notify.extractedMany', { count, shipment }) : t('notify.extracted', { shipment, file }) };
    case 'extractionFailed':
      return { shipment, ...error, title: count > 1 ? t('notify.extractionFailedMany', { count, shipment }) : t('notify.extractionFailed', { shipment, file }) };
    case 'validationFailed':
      return { shipment, ...error, title: t('notify.validationFailed', { shipment }) };
    case 'validated': {
      const findings = last?.findings ?? 0;
      const total = t('notify.findings', { count: findings });
      const summary = findings === 0 ? t('notify.noFindings') : info.critical ? t('notify.findingsCritical', { findings: total, count: info.critical }) : total;
      return { shipment, title: t('notify.validated', { shipment, summary }) };
    }
  }
}
