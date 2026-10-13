import type { Alert } from '../api/types';
import type { I18nState } from '../i18n/I18nContext';

/** The sentence explaining an alert, from its machine-readable detail. */
export function alertMessage(alert: Alert, t: I18nState['t']): string {
  switch (alert.kind) {
    case 'critical':
      return t('dashboard.alerts.critical', { count: alert.detail.critical + alert.detail.high });
    case 'failed-document':
      return alert.detail.error
        ? t('dashboard.alerts.failed', { file: alert.fileName, error: alert.detail.error })
        : t('dashboard.alerts.failedNoError', { file: alert.fileName });
    case 'ocr':
      return alert.detail.citedBy > 0
        ? t('dashboard.alerts.ocrCited', { file: alert.fileName, count: alert.detail.citedBy })
        : t('dashboard.alerts.ocrNew', { file: alert.fileName });
    case 'not-validated':
      return t(alert.detail.reason === 'never' ? 'dashboard.alerts.never' : 'dashboard.alerts.changed');
    case 'stale-destination': {
      const validated = t(`destinations.${alert.detail.validated}`);
      return alert.detail.current
        ? t('dashboard.alerts.stale', { validated, current: t(`destinations.${alert.detail.current}`) })
        : t('dashboard.alerts.staleCleared', { validated });
    }
  }
}
