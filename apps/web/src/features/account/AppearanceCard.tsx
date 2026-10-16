import { CheckIcon, ResetIcon } from '@radix-ui/react-icons';
import { ToggleGroup } from 'radix-ui';
import { useEffect, useId, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { ToggleChips } from '../../components/ui/ToggleChips';
import { useI18n } from '../../i18n/useI18n';
import type { MessageKey } from '../../i18n/keys';
import {
  ACCENT_SWATCH,
  ACCENTS,
  applyAppearance,
  DEFAULT_APPEARANCE,
  DENSITIES,
  FONTS,
  isHexColor,
  MOTIONS,
  PANELS,
  RADII,
  readAppearance,
  SIDEBARS,
  TONES,
  writeAppearance,
  type Accent,
  type Appearance,
} from '../../preferences/appearance';

type ChoiceKey = Exclude<keyof Appearance, 'accent' | 'customAccent'>;

/** Each chip row: its options and where their labels live (appearance.<group>.<value>). */
const ROWS: { key: ChoiceKey; options: readonly string[]; group: string }[] = [
  { key: 'tone', options: TONES, group: 'tones' },
  { key: 'panels', options: PANELS, group: 'panelStyles' },
  { key: 'radius', options: RADII, group: 'radii' },
  { key: 'density', options: DENSITIES, group: 'densities' },
  { key: 'font', options: FONTS, group: 'fonts' },
  { key: 'sidebar', options: SIDEBARS, group: 'sidebars' },
  { key: 'motion', options: MOTIONS, group: 'motions' },
];

/** Accent, background tone, panel edges, corners, density, typeface, sidebar and motion; applied live. */
export function AppearanceCard() {
  const { t } = useI18n();
  const colorId = useId();
  const [appearance, setAppearance] = useState<Appearance>(readAppearance);

  const update = (patch: Partial<Appearance>) => setAppearance((current) => ({ ...current, ...patch }));
  useEffect(() => {
    applyAppearance(appearance);
    writeAppearance(appearance);
  }, [appearance]);
  const isDefault = (Object.keys(DEFAULT_APPEARANCE) as (keyof Appearance)[]).every((k) => appearance[k] === DEFAULT_APPEARANCE[k]);

  return (
    <Card
      title={t('appearance.title')}
      aside={
        <Button variant="ghost" size="sm" onClick={() => update(DEFAULT_APPEARANCE)} disabled={isDefault}>
          <ResetIcon aria-hidden />
          {t('appearance.reset')}
        </Button>
      }
    >
      <p className="muted">{t('appearance.description')}</p>
      <div className="stack-form">
        <div className="field">
          <span className="field-label">{t('appearance.accent')}</span>
          <div className="accent-picker">
            <ToggleGroup.Root
              type="single"
              className="swatches"
              value={appearance.accent}
              onValueChange={(v) => v && update({ accent: v as Accent })}
              aria-label={t('appearance.accent')}
            >
              {ACCENTS.map((accent) => {
                const color = accent === 'custom' ? appearance.customAccent : ACCENT_SWATCH[accent];
                const label = t(`appearance.accents.${accent}` as MessageKey);
                return (
                  <ToggleGroup.Item key={accent} value={accent} className="swatch" style={{ background: color }} aria-label={label} title={label}>
                    {accent === appearance.accent && <CheckIcon aria-hidden />}
                    {accent === 'custom' && accent !== appearance.accent && <span aria-hidden>+</span>}
                  </ToggleGroup.Item>
                );
              })}
            </ToggleGroup.Root>
            {appearance.accent === 'custom' && (
              <label className="color-input" htmlFor={colorId}>
                <input
                  id={colorId}
                  type="color"
                  value={appearance.customAccent}
                  onChange={(e) => isHexColor(e.target.value) && update({ customAccent: e.target.value.toLowerCase() })}
                  aria-label={t('appearance.customColor')}
                />
                <code>{appearance.customAccent}</code>
              </label>
            )}
          </div>
        </div>
        {ROWS.map(({ key, options, group }) => (
          <div className="field" key={key}>
            <span className="field-label">{t(`appearance.${key}` as MessageKey)}</span>
            <ToggleChips
              value={appearance[key]}
              options={options.map((value) => ({ value, label: t(`appearance.${group}.${value}` as MessageKey) }))}
              onValueChange={(value) => update({ [key]: value })}
              ariaLabel={t(`appearance.${key}` as MessageKey)}
            />
          </div>
        ))}
      </div>
    </Card>
  );
}
