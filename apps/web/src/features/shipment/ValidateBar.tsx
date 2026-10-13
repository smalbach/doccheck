import { Button } from '../../components/ui/Button';
import { Checkbox } from '../../components/ui/Checkbox';
import { useI18n } from '../../i18n/useI18n';

export interface ValidateBarProps {
  useAgent: boolean;
  onUseAgentChange: (value: boolean) => void;
  validating: boolean;
  disabled: boolean;
  onValidate: () => void;
}

export function ValidateBar({ useAgent, onUseAgentChange, validating, disabled, onValidate }: ValidateBarProps) {
  const { t } = useI18n();
  return (
    <div className="validate-bar">
      <Checkbox label={t('shipment.agentReview')} checked={useAgent} onCheckedChange={onUseAgentChange} />
      <Button variant="primary" onClick={onValidate} disabled={disabled}>
        {validating ? (useAgent ? t('shipment.validatingAgent') : t('shipment.validating')) : t('shipment.validate')}
      </Button>
    </div>
  );
}
