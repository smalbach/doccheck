import { DownloadIcon, FileTextIcon } from '@radix-ui/react-icons';
import { DropdownMenu } from 'radix-ui';
import type { DutiesView } from '../../api/dutyTypes';
import type { Shipment, Validation } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { useI18n } from '../../i18n/useI18n';
import { downloadJson } from '../../lib/downloadJson';
import { reportFileName } from '../../lib/reportFileName';

export interface ExportMenuProps {
  shipment: Shipment;
  validation: Validation;
  /** Duty and landed-cost estimate with its draft entry summary, included in the JSON when loaded. */
  duties?: DutiesView;
}

/** The validation as a JSON file (for other systems) or a printed report (print stylesheet hides the app chrome). */
export function ExportMenu({ shipment, validation, duties }: ExportMenuProps) {
  const { t } = useI18n();
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button className="no-print">
          <DownloadIcon aria-hidden /> {t('shipment.export')}
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu" align="end" sideOffset={6}>
          <DropdownMenu.Item className="menu-item" onSelect={() => downloadJson(reportFileName(shipment, 'json'), { shipment, validation, ...(duties ? { duties } : {}) })}>
            <DownloadIcon aria-hidden /> {t('shipment.exportJson')}
          </DropdownMenu.Item>
          <DropdownMenu.Item className="menu-item" onSelect={() => setTimeout(() => window.print(), 0)}>
            <FileTextIcon aria-hidden /> {t('shipment.print')}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
