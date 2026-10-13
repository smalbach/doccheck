import type { AdminSettings, SettingKey, SettingView } from '../api/types';

/** One setting from the admin settings list, typed by its key. */
export function settingOf<K extends SettingKey>(settings: AdminSettings, key: K): SettingView<K> {
  const found = settings.settings.find((s) => s.key === key);
  if (!found) throw new Error(`Setting ${key} missing from the API response`);
  return found as SettingView<K>;
}
