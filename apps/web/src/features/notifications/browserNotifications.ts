import { readPreference, writePreference } from '../../preferences/storage';

/** The opt-in to browser notifications, remembered on this device. */
export const BACKGROUND_NOTIFY_KEY = 'doccheck.notifyInBackground';

export type NotifyPermission = NotificationPermission | 'unsupported';

export function readBackgroundNotify(): boolean {
  return readPreference(BACKGROUND_NOTIFY_KEY) === 'on';
}

export function writeBackgroundNotify(on: boolean): void {
  writePreference(BACKGROUND_NOTIFY_KEY, on ? 'on' : 'off');
}

/** What the browser allows, or 'unsupported' without the Notification API. */
export function notifyPermission(): NotifyPermission {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

/** Opted in and allowed: finished runs may notify while the tab is hidden. */
export function backgroundNotifyAllowed(): boolean {
  return readBackgroundNotify() && notifyPermission() === 'granted';
}

/** Asks for permission (only from a click: browsers ignore or penalize unprompted requests). */
export async function requestNotifyPermission(): Promise<NotifyPermission> {
  if (typeof Notification === 'undefined') return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

/**
 * Shows a system notification; a click brings the tab forward and calls `onClick`. `tag` replaces an
 * earlier notification of the same group instead of stacking. Never throws (some browsers only allow
 * notifications from a service worker).
 */
export function showBrowserNotification(title: string, { body, tag, onClick }: { body?: string; tag: string; onClick: () => void }): void {
  try {
    const n = new Notification(title, { ...(body ? { body } : {}), tag, lang: document.documentElement.lang || undefined });
    n.onclick = () => {
      window.focus();
      onClick();
      n.close();
    };
  } catch {
    // Not shown; the toast is still there when the viewer comes back.
  }
}
