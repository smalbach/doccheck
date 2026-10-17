import { useState } from "react";
import {
  CLOUD_OCR_ENGINES,
  type AdminSettings,
  type SettingValues,
  type SettingView,
} from "../../../api/types";
import { Banner } from "../../../components/ui/Banner";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { Checkbox } from "../../../components/ui/Checkbox";
import { Field } from "../../../components/ui/Field";
import { Select } from "../../../components/ui/Select";
import { TextInput } from "../../../components/ui/TextInput";
import type { MessageKey } from "../../../i18n/keys";
import { useI18n } from "../../../i18n/useI18n";
import { SettingSource } from "./SettingSource";

type OcrKey = "ocrEngine" | "ocrUrl" | "ocrLanguages" | "ocrScale" | "ocrPsm";

export interface OcrSettingsCardProps {
  engine: SettingView<"ocrEngine">;
  url: SettingView<"ocrUrl">;
  /** Whether the Unlimited-OCR server answers, when that engine is in use. */
  server?: AdminSettings["ocrServer"];
  languages: SettingView<"ocrLanguages">;
  scale: SettingView<"ocrScale">;
  psm: SettingView<"ocrPsm">;
  options: AdminSettings["options"];
  editable: boolean;
  busy: boolean;
  onSave: (values: Pick<SettingValues, OcrKey>) => void;
  onReset: (key: OcrKey) => void;
}

/** PDF points are 72 per inch, so a render scale of 4 reads the page at 288 dpi. */
const DPI_PER_SCALE = 72;
const URL_PATTERN = /^https?:\/\/[^\s/?#]+(:\d+)?\/?$/;

export function OcrSettingsCard({
  engine,
  url,
  server,
  languages,
  scale,
  psm,
  options,
  editable,
  busy,
  onSave,
  onReset,
}: OcrSettingsCardProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState({
    ocrEngine: engine.value,
    ocrUrl: url.value,
    ocrLanguages: languages.value,
    ocrScale: scale.value,
    ocrPsm: psm.value,
  });
  const tesseract = draft.ocrEngine === "tesseract";
  const cloud = CLOUD_OCR_ENGINES.includes(draft.ocrEngine as never);
  const unlimited = draft.ocrEngine === "unlimited";
  const badUrl = unlimited && !URL_PATTERN.test(draft.ocrUrl.trim());
  const languageName = (code: string) => {
    const key = `admin.ocr.languageNames.${code}` as MessageKey;
    return t(key) === key ? code : t(key);
  };
  const toggle = (code: string, on: boolean) =>
    setDraft((d) => ({
      ...d,
      ocrLanguages: on
        ? [...d.ocrLanguages, code]
        : d.ocrLanguages.filter((c) => c !== code),
    }));
  const changed =
    draft.ocrEngine !== engine.value ||
    draft.ocrUrl.trim() !== url.value ||
    draft.ocrScale !== scale.value ||
    draft.ocrPsm !== psm.value ||
    [...draft.ocrLanguages].sort().join() !==
      [...languages.value].sort().join();
  const scales = Array.from(
    { length: options.ocrScale.max - options.ocrScale.min + 1 },
    (_, i) => String(options.ocrScale.min + i),
  );
  const noLanguage = draft.ocrLanguages.length === 0;

  return (
    <Card title={t("admin.ocr.title")}>
      <p className="muted">{t("admin.ocr.text")}</p>
      <div className="stack-form">
        <div className="setting-row">
          <Field label={t("admin.ocr.engine")}>
            {(id) => (
              <Select
                id={id}
                value={draft.ocrEngine}
                options={options.ocrEngines.map((v) => ({
                  value: v,
                  label: t(`admin.ocr.engines.${v}`),
                }))}
                onValueChange={(v) => setDraft((d) => ({ ...d, ocrEngine: v }))}
                disabled={!editable || busy}
              />
            )}
          </Field>
          <SettingSource
            setting={engine}
            editable={editable}
            busy={busy}
            onReset={() => onReset("ocrEngine")}
          />
        </div>
        <p className="muted small">
          {t(
            tesseract
              ? "admin.ocr.engineHint.tesseract"
              : cloud
                ? "admin.ocr.engineHint.cloud"
                : "admin.ocr.engineHint.unlimited",
          )}
        </p>
        {unlimited && (
          <>
            <div className="setting-row">
              <Field label={t("admin.ocr.url")}>
                {(id) => (
                  <TextInput
                    id={id}
                    value={draft.ocrUrl}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, ocrUrl: e.target.value }))
                    }
                    disabled={!editable || busy}
                    className="mono"
                    spellCheck={false}
                  />
                )}
              </Field>
              <SettingSource
                setting={url}
                editable={editable}
                busy={busy}
                onReset={() => onReset("ocrUrl")}
              />
            </div>
            {badUrl && <Banner tone="error">{t("admin.ocr.badUrl")}</Banner>}
            {server && !server.reachable && engine.value === "unlimited" && (
              <Banner tone="error">
                {t("admin.ocr.serverDown", { url: server.url })}
              </Banner>
            )}
            {server?.reachable && engine.value === "unlimited" && (
              <p className="small">
                {t("admin.ocr.serverUp", { url: server.url })}
              </p>
            )}
          </>
        )}
        {tesseract && (
          <>
            <fieldset className="fieldset">
              <legend className="field-label">
                {t("admin.ocr.languages")}{" "}
                <SettingSource
                  setting={languages}
                  editable={editable}
                  busy={busy}
                  onReset={() => onReset("ocrLanguages")}
                />
              </legend>
              <div className="checkbox-row">
                {options.ocrLanguages.map((code) => (
                  <Checkbox
                    key={code}
                    label={languageName(code)}
                    checked={draft.ocrLanguages.includes(code)}
                    onCheckedChange={(on) => toggle(code, on)}
                    disabled={!editable || busy}
                  />
                ))}
              </div>
            </fieldset>
            <div className="setting-row">
              <Field label={t("admin.ocr.scale")}>
                {(id) => (
                  <Select
                    id={id}
                    value={String(draft.ocrScale)}
                    options={scales.map((s) => ({ value: s, label: `${s}×` }))}
                    onValueChange={(v) =>
                      setDraft((d) => ({ ...d, ocrScale: Number(v) }))
                    }
                    disabled={!editable || busy}
                  />
                )}
              </Field>
              <SettingSource
                setting={scale}
                editable={editable}
                busy={busy}
                onReset={() => onReset("ocrScale")}
              />
            </div>
            <p className="muted small">
              {t("admin.ocr.scaleHint", {
                scale: draft.ocrScale,
                dpi: draft.ocrScale * DPI_PER_SCALE,
              })}
            </p>
            <div className="setting-row">
              <Field label={t("admin.ocr.psm")}>
                {(id) => (
                  <Select
                    id={id}
                    value={draft.ocrPsm}
                    options={options.ocrPsm.map((v) => ({
                      value: v,
                      label: t(`admin.ocr.psmOptions.${v}` as MessageKey),
                    }))}
                    onValueChange={(v) =>
                      setDraft((d) => ({ ...d, ocrPsm: v }))
                    }
                    disabled={!editable || busy}
                  />
                )}
              </Field>
              <SettingSource
                setting={psm}
                editable={editable}
                busy={busy}
                onReset={() => onReset("ocrPsm")}
              />
            </div>
            {noLanguage && (
              <Banner tone="error">{t("admin.ocr.noLanguage")}</Banner>
            )}
          </>
        )}
        {editable && (
          <div>
            <Button
              variant="primary"
              disabled={
                busy || !changed || (tesseract && noLanguage) || badUrl
              }
              onClick={() => onSave({ ...draft, ocrUrl: draft.ocrUrl.trim() })}
            >
              {t("admin.save")}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
