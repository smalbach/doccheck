import { useState } from 'react';
import { Switch } from '../../components/ui/Switch';
import { useI18n } from '../../i18n/useI18n';
import { notifyPermission, readBackgroundNotify, requestNotifyPermission, writeBackgroundNotify, type NotifyPermission } from './browserNotifications';

/**
 * Opt-in to browser notifications when a run ends while DocCheck is in the background. Permission is
 * asked only when the viewer turns it on; blocked or unsupported browsers say so and keep it off.
 */
export function BackgroundNotifySetting() {
  const { t } = useI18n();
  const [permission, setPermission] = useState<NotifyPermission>(notifyPermission);
  const [on, setOn] = useState(() => readBackgroundNotify() && permission === 'granted');

  const change = async (checked: boolean) => {
    if (!checked) {
      setOn(false);
      writeBackgroundNotify(false);
      return;
    }
    const granted = permission === 'granted' ? permission : await requestNotifyPermission();
    setPermission(granted);
    setOn(granted === 'granted');
    writeBackgroundNotify(granted === 'granted');
  };

  const note = permission === 'unsupported' ? t('notify.unsupported') : permission === 'denied' ? t('notify.blocked') : undefined;
  return (
    <div className="field">
      <Switch label={t('notify.background')} checked={on} disabled={permission === 'unsupported' || permission === 'denied'} onCheckedChange={(checked) => void change(checked)} />
      {note && <p className="muted small notify-note">{note}</p>}
    </div>
  );
}
