import type { SettingView } from '../../../api/types';
import { Button } from '../../../components/ui/Button';
import { Tag } from '../../../components/ui/Tag';
import { useI18n } from '../../../i18n/useI18n';

export interface SettingSourceProps {
  setting: SettingView;
  editable: boolean;
  busy: boolean;
  onReset: () => void;
}

/** Where the value comes from (default, .env, an admin) and a way back to .env. */
export function SettingSource({ setting, editable, busy, onReset }: SettingSourceProps) {
  const { t, formatDateTime } = useI18n();
  const date = setting.updatedAt ? formatDateTime(setting.updatedAt) : '';
  const label =
    setting.source === 'admin'
      ? setting.updatedBy
        ? t('admin.source.admin', { who: setting.updatedBy, date })
        : t('admin.source.adminNoUser', { date })
      : t(`admin.source.${setting.source}`);
  return (
    <span className="setting-source">
      <Tag tone={setting.source === 'admin' ? 'accent' : 'neutral'}>{label}</Tag>
      {editable && setting.source === 'admin' && (
        <Button variant="link" size="sm" onClick={onReset} disabled={busy}>
          {setting.envValue !== undefined ? t('admin.reset') : t('admin.resetDefault')}
        </Button>
      )}
    </span>
  );
}
