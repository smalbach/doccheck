import { useState, type FormEvent } from 'react';
import { api } from '../../api/client';
import type { RuleParamKey, RuleSettings } from '../../api/types';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { Select } from '../../components/ui/Select';
import { Switch } from '../../components/ui/Switch';
import { TextInput } from '../../components/ui/TextInput';
import { useI18n } from '../../i18n/useI18n';
import { compareRuleIds } from '../../lib/compareRuleIds';
import { errorMessage } from '../../lib/errorMessage';
import { configOf, draftOf, shownBounds, type RuleDraft } from './ruleDraft';

const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;

export interface RuleSettingsFormProps {
  settings: RuleSettings;
  onSaved: (settings: RuleSettings) => void;
}

/** Each rule on or off with its severity and tolerances, plus the account's known SCACs; saved together. */
export function RuleSettingsForm({ settings, onSaved }: RuleSettingsFormProps) {
  const { t, formatDateTime } = useI18n();
  const [draft, setDraft] = useState<RuleDraft>(() => draftOf(settings));
  const [status, setStatus] = useState<{ tone: 'ok' | 'error'; text: string }>();
  const [busy, setBusy] = useState(false);
  const saved = JSON.stringify(draftOf(settings));
  const dirty = JSON.stringify(draft) !== saved;
  const rules = [...settings.rules].sort((a, b) => compareRuleIds(a.id, b.id));

  const apply = async (call: () => Promise<RuleSettings>, done: string) => {
    setBusy(true);
    setStatus(undefined);
    try {
      const next = await call();
      onSaved(next);
      setDraft(draftOf(next));
      setStatus({ tone: 'ok', text: done });
    } catch (err) {
      setStatus({ tone: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const result = configOf(settings, draft);
    if ('error' in result) {
      const { key, spec } = result.error;
      setStatus({
        tone: 'error',
        text: key === 'scacs' ? t('ruleSettings.scacsInvalid') : t('ruleSettings.paramInvalid', { name: t(`ruleSettings.params.${key}`), ...shownBounds(spec!) }),
      });
      return;
    }
    void apply(() => api.saveRuleSettings(result.config), t('ruleSettings.saved'));
  };

  const setParam = (key: RuleParamKey, value: string) => setDraft((d) => ({ ...d, params: { ...d.params, [key]: value } }));
  const off = rules.filter((r) => !draft.enabled[r.id]).length;

  return (
    <Card
      title={t('ruleSettings.rulesTitle')}
      aside={settings.updatedAt ? <span className="muted small">{t('ruleSettings.updated', { date: formatDateTime(settings.updatedAt) })}</span> : <span className="muted small">{t('ruleSettings.defaults')}</span>}
    >
      <p className="muted">{t('ruleSettings.rulesText')}</p>
      <form onSubmit={submit} aria-busy={busy}>
        {status && <Banner tone={status.tone}>{status.text}</Banner>}
        <ul className="rule-settings">
          {rules.map((r) => (
            <li key={r.id} className={draft.enabled[r.id] ? 'rule-setting' : 'rule-setting rule-setting-off'}>
              <div className="rule-setting-head">
                <Switch label={t('ruleSettings.run', { id: r.id })} checked={draft.enabled[r.id] !== false} onCheckedChange={(on) => setDraft((d) => ({ ...d, enabled: { ...d.enabled, [r.id]: on } }))} disabled={busy} />
                <span className="rule-setting-title" lang="en">
                  {r.title}
                </span>
                <span className="muted small">{r.destinations.join(' · ')}</span>
              </div>
              <div className="rule-setting-controls">
                <Field label={t('ruleSettings.severity')}>
                  {(id) => (
                    <Select
                      id={id}
                      value={draft.severity[r.id] ?? 'default'}
                      onValueChange={(v) => setDraft((d) => ({ ...d, severity: { ...d.severity, [r.id]: v } }))}
                      disabled={busy || !draft.enabled[r.id]}
                      options={[
                        { value: 'default', label: t('ruleSettings.defaultSeverity', { severity: t(`severity.${r.severity}`) }) },
                        ...SEVERITIES.map((s) => ({ value: s, label: t(`severity.${s}`) })),
                      ]}
                    />
                  )}
                </Field>
                {r.params?.map((p) => {
                  const { min, max } = shownBounds(p);
                  return (
                    <Field key={p.key} label={t(`ruleSettings.params.${p.key}`)}>
                      {(id) => (
                        <TextInput
                          id={id}
                          className="rule-param-input"
                          type="number"
                          inputMode="decimal"
                          min={min}
                          max={max}
                          step="any"
                          value={draft.params[p.key] ?? ''}
                          onChange={(e) => setParam(p.key, e.target.value)}
                          disabled={busy || !draft.enabled[r.id]}
                        />
                      )}
                    </Field>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
        <div className="rule-settings-scacs">
          <Field label={t('ruleSettings.scacs')} grow>
            {(id) => <TextInput id={id} value={draft.scacs} placeholder="ABCD, EFGH" onChange={(e) => setDraft((d) => ({ ...d, scacs: e.target.value }))} disabled={busy} autoCapitalize="characters" spellCheck={false} />}
          </Field>
          <p className="muted small">{t('ruleSettings.scacsText', { list: settings.bundledScacs.join(', ') })}</p>
        </div>
        <div className="rule-settings-actions">
          <Button type="submit" variant="primary" disabled={busy || !dirty}>
            {busy ? t('common.saving') : t('common.save')}
          </Button>
          <Button onClick={() => void apply(() => api.resetRuleSettings(), t('ruleSettings.resetDone'))} disabled={busy || (!settings.updatedAt && !dirty)}>
            {t('ruleSettings.reset')}
          </Button>
          <span className="muted small" role="status">
            {off > 0 ? t('ruleSettings.offCount', { count: off }) : ''}
          </span>
        </div>
      </form>
    </Card>
  );
}
