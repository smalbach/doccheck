import { useCallback, useEffect, useState } from 'react';
import { PortalError, portalApi, type PortalView } from '../../api/portal';
import { LanguageSelect } from '../../components/layout/LanguageSelect';
import { LogoMark } from '../../components/layout/LogoMark';
import { SkipLink } from '../../components/layout/SkipLink';
import { ThemeToggle } from '../../components/layout/ThemeToggle';
import { Banner } from '../../components/ui/Banner';
import { Card } from '../../components/ui/Card';
import { Spinner } from '../../components/ui/Spinner';
import type { MessageKey } from '../../i18n/keys';
import { isLocale } from '../../i18n/locales';
import { useI18n } from '../../i18n/useI18n';
import { errorMessage } from '../../lib/errorMessage';
import { PortalFindings } from './PortalFindings';
import { PortalHistory } from './PortalHistory';
import { PortalStatusTag } from './PortalStatusTag';
import { PortalUploadForm } from './PortalUploadForm';
import { PortalUploads } from './PortalUploads';

/** Kept for this tab only, so a reload works once the token is out of the address bar. */
const TOKEN_KEY = 'doccheck.portal.token';
const LANGUAGE_SET_KEY = 'doccheck.portal.language';
const POLL_MS = 3000;
const REASONS = new Set(['invalid', 'expired', 'revoked', 'closed', 'throttled']);

const readSession = (key: string) => {
  try {
    return sessionStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
};
const writeSession = (key: string, value: string) => {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Private windows can refuse storage: the page still works until it is reloaded.
  }
};

/**
 * The supplier portal (docs/PORTAL.md): what a supplier sees with the link from an email, without an
 * account. One request only: what to correct in their language, an upload form, how their uploads
 * went, and their earlier requests by status.
 */
export function PortalPage({ token: fromLink }: { token?: string }) {
  const { t, setLocale, formatDateTime } = useI18n();
  const [token] = useState(() => fromLink ?? readSession(TOKEN_KEY));
  const [view, setView] = useState<PortalView>();
  // A refusal's message key, or the error's own text.
  const [failure, setFailure] = useState<{ key?: MessageKey; text?: string }>();
  const [notice, setNotice] = useState<string>();

  // The token leaves the address bar (and the browser history) as soon as the page has it.
  useEffect(() => {
    if (!fromLink) return;
    writeSession(TOKEN_KEY, fromLink);
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/portal`);
  }, [fromLink]);

  const load = useCallback(async () => {
    if (!token) return setFailure({ key: 'portal.errors.invalid' });
    try {
      setView(await portalApi.session(token));
      setFailure(undefined);
    } catch (err) {
      const reason = err instanceof PortalError ? err.reason : undefined;
      setFailure(reason && REASONS.has(reason) ? { key: `portal.errors.${reason}` as MessageKey } : { text: errorMessage(err) });
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);
  const failureText = failure && (failure.key ? t(failure.key) : failure.text);

  // The language the importer wrote in, the first time this tab opens the request.
  useEffect(() => {
    if (!view?.language || readSession(LANGUAGE_SET_KEY)) return;
    writeSession(LANGUAGE_SET_KEY, '1');
    if (isLocale(view.language)) setLocale(view.language);
  }, [view?.language, setLocale]);

  const checking = view?.status === 'checking';
  useEffect(() => {
    if (!checking) return;
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [checking, load]);

  const title = view
    ? view.kind === 'pre_shipment'
      ? t('portal.titlePreShipment', { reference: view.reference ?? '' })
      : t('portal.titleCorrection', { reference: view.reference ?? '' })
    : t('portal.title');

  useEffect(() => {
    document.title = `${title} · DocCheck`;
  }, [title]);

  return (
    <div className="public-page portal-page">
      <SkipLink />
      <header className="public-header portal-header">
        <span className="brand">
          <LogoMark />
          <span>DocCheck</span>
        </span>
        <div className="public-header-tools">
          <LanguageSelect />
          <ThemeToggle />
        </div>
      </header>
      <main className="portal-main" id="main-content" tabIndex={-1}>
        {!view ? (
          <Card>
            <h1>{t('portal.title')}</h1>
            {failureText ? <Banner tone="error">{failureText}</Banner> : <Spinner label={t('common.loading')} />}
          </Card>
        ) : (
          <>
            <Card className="portal-intro">
              <p className="portal-eyebrow muted small">
                {t(`portal.kind.${view.kind}`)}
                {view.supplier && ` · ${t('portal.forSupplier', { supplier: view.supplier })}`}
              </p>
              <h1>{title}</h1>
              <p>{view.kind === 'pre_shipment' ? t('portal.introPreShipment', { importer: view.importer }) : t('portal.introCorrection', { importer: view.importer })}</p>
              <div className="portal-meta">
                <PortalStatusTag status={view.status} />
                {view.destination && <span className="muted small">{t('portal.destination', { destination: t(`destinations.long.${view.destination}`) })}</span>}
                <span className="muted small">{t('portal.expires', { date: formatDateTime(view.expiresAt) })}</span>
              </div>
            </Card>
            {failureText && <Banner tone="error">{failureText}</Banner>}
            {notice && <Banner tone="ok">{notice}</Banner>}
            <PortalFindings view={view} />
            {view.status !== 'closed' && token && (
              <PortalUploadForm
                token={token}
                importer={view.importer}
                limits={view.limits}
                onUploaded={(next) => {
                  setView(next);
                  setNotice(t('portal.uploaded'));
                }}
              />
            )}
            {view.uploads.length > 0 && <PortalUploads uploads={view.uploads} />}
            {view.history.length > 1 && <PortalHistory history={view.history} importer={view.importer} />}
            <p className="muted small portal-privacy">{t('portal.privacy', { importer: view.importer })}</p>
          </>
        )}
      </main>
    </div>
  );
}
