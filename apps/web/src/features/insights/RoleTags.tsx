import type { PartyRoleName } from '../../api/types';
import { Tag } from '../../components/ui/Tag';
import { useI18n } from '../../i18n/useI18n';

/** The roles a company plays on the documents: seller, shipper, buyer… */
export function RoleTags({ roles }: { roles: readonly PartyRoleName[] }) {
  const { t } = useI18n();
  return (
    <span className="tag-list">
      {roles.map((r) => (
        <Tag key={r}>{t(`insights.roles.${r}`)}</Tag>
      ))}
    </span>
  );
}
