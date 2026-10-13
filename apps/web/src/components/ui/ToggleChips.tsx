import { ToggleGroup } from 'radix-ui';

export interface ToggleChipsProps<T extends string> {
  value: T;
  options: readonly { value: T; label: string }[];
  onValueChange: (value: T) => void;
  ariaLabel: string;
}

/** A single choice shown as chips (filters). One is always selected. */
export function ToggleChips<T extends string>({ value, options, onValueChange, ariaLabel }: ToggleChipsProps<T>) {
  return (
    <ToggleGroup.Root type="single" className="chips" value={value} onValueChange={(v) => v && onValueChange(v as T)} aria-label={ariaLabel}>
      {options.map((o) => (
        <ToggleGroup.Item key={o.value} value={o.value} className="chip">
          {o.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
