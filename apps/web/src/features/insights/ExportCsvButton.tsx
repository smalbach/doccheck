import { DownloadIcon } from '@radix-ui/react-icons';
import { Button } from '../../components/ui/Button';
import { useI18n } from '../../i18n/useI18n';

/** A link that downloads the CSV at `href` (the matching rows, with the filters in its query string). */
export function ExportCsvButton({ href }: { href: string }) {
  const { t } = useI18n();
  return (
    <Button asChild>
      <a href={href} download title={t('insights.exportCsvHint')}>
        <DownloadIcon aria-hidden /> {t('insights.exportCsv')}
      </a>
    </Button>
  );
}
