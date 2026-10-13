import type { SettingView } from '../../../api/types';
import { Card } from '../../../components/ui/Card';
import { Switch } from '../../../components/ui/Switch';
import { useI18n } from '../../../i18n/useI18n';
import { SettingSource } from './SettingSource';

export interface AccountsSettingCardProps {
  setting: SettingView<'registrationOpen'>;
  editable: boolean;
  busy: boolean;
  onSave: (open: boolean) => void;
  onReset: () => void;
}

export function AccountsSettingCard({ setting, editable, busy, onSave, onReset }: AccountsSettingCardProps) {
  const { t } = useI18n();
  return (
    <Card title={t('admin.accounts.title')} aside={<SettingSource setting={setting} editable={editable} busy={busy} onReset={onReset} />}>
      <p className="muted">{t('admin.accounts.text')}</p>
      <Switch label={t('admin.accounts.label')} checked={setting.value} onCheckedChange={onSave} disabled={!editable || busy} />
    </Card>
  );
}
