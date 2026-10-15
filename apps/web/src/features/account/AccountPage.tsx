import { PageHeader } from '../../components/ui/PageHeader';
import { useI18n } from '../../i18n/useI18n';
import { DeleteAccountCard } from './DeleteAccountCard';
import { IntakeAddressCard } from './IntakeAddressCard';
import { PasswordCard } from './PasswordCard';
import { PreferencesCard } from './PreferencesCard';
import { ProfileCard } from './ProfileCard';
import { SessionCard } from './SessionCard';

export function AccountPage() {
  const { t } = useI18n();
  return (
    <div className="page page-narrow">
      <PageHeader title={t('account.title')} description={t('account.description')} />
      <ProfileCard />
      <PreferencesCard />
      <IntakeAddressCard />
      <PasswordCard />
      <SessionCard />
      <DeleteAccountCard />
    </div>
  );
}
