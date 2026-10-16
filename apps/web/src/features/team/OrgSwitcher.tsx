import { CheckIcon, ChevronDownIcon, PlusIcon } from '@radix-ui/react-icons';
import { Dialog, DropdownMenu } from 'radix-ui';
import { useState, type FormEvent } from 'react';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Field } from '../../components/ui/Field';
import { TextInput } from '../../components/ui/TextInput';
import { useI18n } from '../../i18n/useI18n';
import { errorMessage } from '../../lib/errorMessage';
import { useOrg } from './useOrg';

/** The organization the app works in, at the top of the sidebar: switch, or make a new one. */
export function OrgSwitcher() {
  const { t } = useI18n();
  const { org, orgs, switchTo, create } = useOrg();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  if (!org) return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await create(name.trim());
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger className="org-switcher" aria-label={t('team.switcher.label', { name: org.name })}>
          <span className="org-switcher-text">
            <span className="org-switcher-name">{org.name}</span>
            <span className="org-switcher-role">{t(`team.roles.${org.role}`)}</span>
          </span>
          <ChevronDownIcon aria-hidden />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="menu" align="start" sideOffset={6}>
            <DropdownMenu.Label className="menu-label">{t('team.switcher.heading')}</DropdownMenu.Label>
            {orgs.map((o) => (
              <DropdownMenu.Item key={o.id} className="menu-item" onSelect={() => o.id !== org.id && void switchTo(o.id)} aria-current={o.id === org.id ? 'true' : undefined}>
                <span className="menu-check">{o.id === org.id && <CheckIcon aria-hidden />}</span>
                <span>
                  {o.personal ? t('team.switcher.personal', { name: o.name }) : o.name}
                  <span className="muted small"> · {t(`team.roles.${o.role}`)}</span>
                </span>
              </DropdownMenu.Item>
            ))}
            <DropdownMenu.Separator className="menu-separator" />
            <DropdownMenu.Item className="menu-item" onSelect={() => setCreating(true)}>
              <PlusIcon aria-hidden /> {t('team.switcher.new')}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <Dialog.Root open={creating} onOpenChange={setCreating}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog">
            <Dialog.Title className="dialog-title">{t('team.switcher.newTitle')}</Dialog.Title>
            <Dialog.Description className="dialog-description">{t('team.switcher.newText')}</Dialog.Description>
            <form className="stack-form" onSubmit={(e) => void submit(e)}>
              {error && <Banner tone="error">{error}</Banner>}
              <Field label={t('team.settings.name')}>{(id) => <TextInput id={id} required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
              <div className="dialog-actions">
                <Dialog.Close asChild>
                  <Button>{t('common.cancel')}</Button>
                </Dialog.Close>
                <Button type="submit" variant="primary" disabled={busy || !name.trim()}>
                  {busy ? t('common.saving') : t('team.switcher.create')}
                </Button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
