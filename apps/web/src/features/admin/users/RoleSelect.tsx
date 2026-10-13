import type { Role, UserSummary } from '../../../api/types';
import { Select } from '../../../components/ui/Select';
import { useI18n } from '../../../i18n/useI18n';

const ROLES: readonly Role[] = ['user', 'admin'];

export interface RoleSelectProps {
  user: UserSummary;
  isSelf: boolean;
  disabled: boolean;
  onChange: (role: Role) => void;
}

/** Your own role is shown, not editable: no admin can lock themselves out. */
export function RoleSelect({ user, isSelf, disabled, onChange }: RoleSelectProps) {
  const { t } = useI18n();
  if (isSelf) return <span>{t(`admin.roles.${user.role}`)}</span>;
  return (
    <Select
      value={user.role}
      options={ROLES.map((r) => ({ value: r, label: t(`admin.roles.${r}`) }))}
      onValueChange={onChange}
      ariaLabel={`${t('admin.columns.role')} · ${user.name}`}
      disabled={disabled}
    />
  );
}
