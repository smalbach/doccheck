import { DesktopIcon, MoonIcon, SunIcon } from '@radix-ui/react-icons';
import { ToggleGroup } from 'radix-ui';
import type { ComponentType } from 'react';
import { useI18n } from '../../i18n/useI18n';
import { THEMES, type Theme } from '../../preferences/theme';
import { useTheme } from '../../preferences/useTheme';

const ICON: Record<Theme, ComponentType<{ 'aria-hidden'?: boolean }>> = { system: DesktopIcon, light: SunIcon, dark: MoonIcon };

/** System, light or dark, as three icon buttons with accessible names. */
export function ThemeToggle({ showLabels = false }: { showLabels?: boolean }) {
  const { theme, setTheme } = useTheme();
  const { t } = useI18n();
  return (
    <ToggleGroup.Root type="single" className="theme-toggle" value={theme} onValueChange={(v) => v && setTheme(v as Theme)} aria-label={t('prefs.theme')}>
      {THEMES.map((value) => {
        const Icon = ICON[value];
        const label = t(`prefs.themes.${value}`);
        return (
          <ToggleGroup.Item key={value} value={value} className="theme-toggle-item" aria-label={showLabels ? undefined : label} title={label}>
            <Icon aria-hidden />
            {showLabels && <span>{label}</span>}
          </ToggleGroup.Item>
        );
      })}
    </ToggleGroup.Root>
  );
}
