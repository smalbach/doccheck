import { CheckIcon } from '@radix-ui/react-icons';
import { Checkbox as RadixCheckbox, Label } from 'radix-ui';
import { useId } from 'react';

export interface CheckboxProps {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}

export function Checkbox({ label, checked, onCheckedChange, disabled }: CheckboxProps) {
  const id = useId();
  return (
    <span className="checkbox">
      <RadixCheckbox.Root id={id} className="checkbox-root" checked={checked} onCheckedChange={(value) => onCheckedChange(value === true)} disabled={disabled}>
        <RadixCheckbox.Indicator className="checkbox-indicator">
          <CheckIcon />
        </RadixCheckbox.Indicator>
      </RadixCheckbox.Root>
      <Label.Root htmlFor={id}>{label}</Label.Root>
    </span>
  );
}
