import { Button } from '../../components/ui/Button';
import { Checkbox } from '../../components/ui/Checkbox';

export interface ValidateBarProps {
  useAgent: boolean;
  onUseAgentChange: (value: boolean) => void;
  validating: boolean;
  disabled: boolean;
  onValidate: () => void;
}

export function ValidateBar({ useAgent, onUseAgentChange, validating, disabled, onValidate }: ValidateBarProps) {
  return (
    <div className="validate-bar">
      <Checkbox label="Agent review (local model)" checked={useAgent} onCheckedChange={onUseAgentChange} />
      <Button variant="primary" onClick={onValidate} disabled={disabled}>
        {validating ? (useAgent ? 'Validating and reviewing…' : 'Validating…') : 'Validate'}
      </Button>
    </div>
  );
}
