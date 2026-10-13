import type { SettingView } from '../../../api/types';
import { Card } from '../../../components/ui/Card';
import { Switch } from '../../../components/ui/Switch';
import { useI18n } from '../../../i18n/useI18n';
import { SettingSource } from './SettingSource';

export interface AgentSettingCardProps {
  setting: SettingView<'agentEnabled'>;
  editable: boolean;
  busy: boolean;
  onSave: (enabled: boolean) => void;
  onReset: () => void;
}

export function AgentSettingCard({ setting, editable, busy, onSave, onReset }: AgentSettingCardProps) {
  const { t } = useI18n();
  return (
    <Card title={t('admin.agent.title')} aside={<SettingSource setting={setting} editable={editable} busy={busy} onReset={onReset} />}>
      <p className="muted">{t('admin.agent.text')}</p>
      <Switch label={t('admin.agent.label')} checked={setting.value} onCheckedChange={onSave} disabled={!editable || busy} />
    </Card>
  );
}
