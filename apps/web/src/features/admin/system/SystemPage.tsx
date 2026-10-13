import { LoadingCard } from '../../../components/layout/LoadingCard';
import { Card } from '../../../components/ui/Card';
import { PageHeader } from '../../../components/ui/PageHeader';
import type { MessageKey } from '../../../i18n/keys';
import { MailServerCard } from '../../mail/MailServerCard';
import { useI18n } from '../../../i18n/useI18n';
import { StatusItem } from './StatusItem';
import { useSystemStatus } from './useSystemStatus';

export function SystemPage() {
  const { t } = useI18n();
  const { status, error } = useSystemStatus();
  if (!status) return <LoadingCard error={error} />;
  const language = (code: string) => {
    const key = `admin.ocr.languageNames.${code}` as MessageKey;
    return t(key) === key ? code : t(key);
  };
  const s = status;
  return (
    <div className="page page-narrow">
      <PageHeader title={t('admin.system')} description={t('admin.systemDescription')} />
      <Card>
        <dl className="status-list">
          <StatusItem label={t('admin.status.ollama')} tone={s.ollama.reachable ? 'ok' : 'error'}>
            {s.ollama.url} · {s.ollama.reachable ? t('admin.status.reachable', { count: s.ollama.models }) : t('admin.status.unreachable')}
          </StatusItem>
          <StatusItem label={t('admin.status.model')}>
            {s.model.provider}
            {s.model.build && <span className="muted"> · {t('admin.status.build', { build: s.model.build })}</span>}
          </StatusItem>
          <StatusItem label={t('admin.status.embeddings')} tone={s.embeddings.chunks === null ? 'error' : undefined}>
            {s.embeddings.chunks === null ? t('admin.status.noIndex', { model: s.embeddings.model }) : t('admin.status.chunks', { model: s.embeddings.model, count: s.embeddings.chunks })}
          </StatusItem>
          <StatusItem label={t('admin.status.ocr')}>
            {s.ocr.engine === 'unlimited' ? t('admin.ocr.engines.unlimited') : t('admin.status.ocrValue', { languages: s.ocr.languages.map(language).join(', '), scale: s.ocr.scale, psm: s.ocr.psm })}
          </StatusItem>
          <StatusItem label={t('admin.status.agent')}>{s.agentEnabled ? t('admin.status.on') : t('admin.status.off')}</StatusItem>
          <StatusItem label={t('admin.status.queue')}>{t(`admin.status.queues.${s.queue}`)}</StatusItem>
          <StatusItem label={t('admin.status.storage')}>{t(`admin.status.storages.${s.storage}`)}</StatusItem>
          <StatusItem label={t('admin.status.cache')}>{t('admin.status.cacheValue', { mode: s.cache.mode, dir: s.cache.dir ?? '—' })}</StatusItem>
          <StatusItem label={t('admin.status.demo')}>{s.demo ? t('admin.status.on') : t('admin.status.off')}</StatusItem>
          <StatusItem label={t('admin.status.data')}>{t('admin.status.dataValue', s.counts)}</StatusItem>
        </dl>
      </Card>
      <MailServerCard />
    </div>
  );
}
