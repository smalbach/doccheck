import { Label, Switch as RadixSwitch } from 'radix-ui';
import { useId } from 'react';

export interface SwitchProps {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}

export function Switch({ label, checked, onCheckedChange, disabled }: SwitchProps) {
  const id = useId();
  return (
    <span className="switch">
      <RadixSwitch.Root id={id} className="switch-root" checked={checked} onCheckedChange={onCheckedChange} disabled={disabled}>
        <RadixSwitch.Thumb className="switch-thumb" />
      </RadixSwitch.Root>
      <Label.Root htmlFor={id}>{label}</Label.Root>
    </span>
  );
}
