import type { SampleError } from '../../api/types';
import { Tag } from '../../components/ui/Tag';
import type { MessageKey } from '../../i18n/keys';
import { useI18n } from '../../i18n/useI18n';

export function SampleErrorTags({ errors }: { errors: readonly SampleError[] }) {
  const { t } = useI18n();
  if (errors.length === 0) return <Tag tone="ok">{t('samples.clean')}</Tag>;
  return (
    <>
      {errors.map((e, i) => {
        const key = `samples.errorKinds.${e.kind}` as MessageKey;
        const label = t(key);
        return <Tag key={`${e.kind}-${i}`}>{label === key ? e.kind : label}</Tag>;
      })}
    </>
  );
}
