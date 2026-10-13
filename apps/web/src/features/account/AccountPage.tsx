import { PageHeader } from '../../components/ui/PageHeader';
import { PasswordCard } from './PasswordCard';
import { ProfileCard } from './ProfileCard';
import { SessionCard } from './SessionCard';

export function AccountPage() {
  return (
    <div className="page page-narrow">
      <PageHeader title="Account" description="Your profile, password and session." />
      <ProfileCard />
      <PasswordCard />
      <SessionCard />
    </div>
  );
}
