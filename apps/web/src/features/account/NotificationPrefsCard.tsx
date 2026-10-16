import { useEffect, useState } from 'react';
import { teamApi } from '../../api/teamClient';
import { NOTIFICATION_KINDS, type NotificationKind, type NotificationPrefs } from '../../api/teamTypes';
import { LoadingCard } from '../../components/layout/LoadingCard';
import { Banner } from '../../components/ui/Banner';
import { Card } from '../../components/ui/Card';
import { Switch } from '../../components/ui/Switch';
import { useQuery } from '../../hooks/useQuery';
import { useI18n } from '../../i18n/useI18n';
import { errorMessage } from '../../lib/errorMessage';

/** Per kind of notification: shown in the app, emailed, both or neither. Saved on each change. */
export function NotificationPrefsCard() {
  const { t } = useI18n();
  const { data, error } = useQuery('notification-prefs', teamApi.notificationPrefs);
  const [prefs, setPrefs] = useState<NotificationPrefs>();
  const [saveError, setSaveError] = useState<string>();
  useEffect(() => setPrefs(data), [data]);
  if (!prefs) return <LoadingCard error={error} />;

  const change = (kind: NotificationKind, channel: 'inApp' | 'email', value: boolean) => {
    const next = { ...prefs, [kind]: { ...prefs[kind], [channel]: value } };
    setPrefs(next);
    teamApi.setNotificationPrefs({ [kind]: next[kind] }).then(
      () => setSaveError(undefined),
      (err: unknown) => setSaveError(errorMessage(err)),
    );
  };
  return (
    <Card title={t('team.notifications.prefsTitle')}>
      <p className="muted">{t('team.notifications.prefsText')}</p>
      {saveError && <Banner tone="error">{saveError}</Banner>}
      {NOTIFICATION_KINDS.map((kind) => (
        <fieldset key={kind} className="fieldset">
          <legend>{t(`team.notifications.kinds.${kind}`)}</legend>
          <div className="checkbox-row">
            <Switch label={t('team.notifications.inApp')} checked={prefs[kind].inApp} onCheckedChange={(v) => change(kind, 'inApp', v)} />
            <Switch label={t('team.notifications.email')} checked={prefs[kind].email} onCheckedChange={(v) => change(kind, 'email', v)} />
          </div>
        </fieldset>
      ))}
    </Card>
  );
}
