import type { PortalFinding, PortalView } from '../../api/portal';
import { Card } from '../../components/ui/Card';
import { Tag } from '../../components/ui/Tag';
import { DOCUMENT_TYPE_KEY } from '../../constants/documentTypes';
import { useI18n } from '../../i18n/useI18n';
import { ruleGuideKey } from '../../lib/findingReview';

/** What the supplier has to correct (and what is fixed already), then the checks left for after shipping. */
export function PortalFindings({ view }: { view: PortalView }) {
  const { t, formatDateTime } = useI18n();
  const open = view.findings.filter((f) => f.state === 'open');
  const fixed = view.findings.filter((f) => f.state === 'fixed');
  const waitingForDrafts = view.kind === 'pre_shipment' && view.uploads.length === 0;
  return (
    <>
      <Card title={t('portal.findingsTitle')} aside={view.validatedAt && <span className="muted small">{t('portal.checkedAt', { date: formatDateTime(view.validatedAt) })}</span>}>
        {waitingForDrafts ? (
          <p className="muted">{t('portal.findingsNoneYet')}</p>
        ) : open.length === 0 && view.status !== 'checking' ? (
          <p>{t('portal.findingsNone')}</p>
        ) : null}
        {view.findings.length > 0 && (
          <ol className="portal-findings">
            {[...open, ...fixed].map((f) => (
              <li key={f.fingerprint}>
                <FindingItem finding={f} />
              </li>
            ))}
          </ol>
        )}
      </Card>
      {view.skipped.length > 0 && (
        <Card title={t('portal.skippedTitle')}>
          <p className="muted">{t('portal.skippedText')}</p>
          <ul className="portal-skipped">
            {view.skipped.map((s) => (
              <li key={s.ruleId}>
                {s.reason === 'history' ? t('portal.skippedHistory', { rule: s.ruleId }) : t('portal.skippedItem', { rule: s.ruleId, documents: s.missing.map((d) => t(DOCUMENT_TYPE_KEY[d])).join(', ') })}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

function FindingItem({ finding: f }: { finding: PortalFinding }) {
  const { t } = useI18n();
  const problem = ruleGuideKey(f.ruleId, 'problem');
  const action = ruleGuideKey(f.ruleId, 'action');
  const fixed = f.state === 'fixed';
  return (
    <article className={fixed ? 'portal-finding portal-finding-fixed' : 'portal-finding'}>
      <header className="portal-finding-head">
        <Tag tone={fixed ? 'ok' : 'accent'}>{fixed ? t('portal.fixed') : t('portal.toFix')}</Tag>
        {!fixed && <span className={`severity severity-${f.severity}`}>{t(`severity.${f.severity}`)}</span>}
        <span className="muted small">{f.ruleId}</span>
      </header>
      {/* Rules without a translated guide keep the rule's own (English) sentence. */}
      <p className="portal-finding-problem" lang={problem ? undefined : 'en'}>
        {problem ? t(problem) : f.message}
      </p>
      {f.evidence.length > 0 && (
        <ul className="evidence">
          {f.evidence.map((e, i) => (
            <li key={i}>
              {t(DOCUMENT_TYPE_KEY[e.documentType])} · <code>{e.field}</code>: <strong>{e.value || `(${t('portal.missingValue')})`}</strong>
              {e.page && <span className="muted small"> · {t('portal.page', { page: e.page })}</span>}
            </li>
          ))}
        </ul>
      )}
      {action && !fixed && (
        <p className="portal-finding-action">
          <strong>{t('portal.whatToDo')}:</strong> {t(action)}
        </p>
      )}
      {f.regulation && !fixed && (
        <p className="small">
          <a href={f.regulation.url} target="_blank" rel="noopener noreferrer" lang="en">
            {t('portal.regulation', { title: f.regulation.title })}
          </a>
        </p>
      )}
    </article>
  );
}
