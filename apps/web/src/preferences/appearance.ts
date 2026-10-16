import { readPreference, writePreference } from './storage';

/**
 * Look-and-feel choices beyond light/dark. Each one becomes a data attribute on <html>
 * (styles/appearance.css maps it to tokens); defaults set no attribute, so tokens.css stays the source of truth.
 */
export const ACCENTS = ['teal', 'blue', 'indigo', 'violet', 'pink', 'graphite', 'custom'] as const;
export const TONES = ['neutral', 'cool', 'warm'] as const;
export const RADII = ['none', 'small', 'medium', 'large'] as const;
export const PANELS = ['subtle', 'strong', 'shadow', 'flat'] as const;
export const DENSITIES = ['compact', 'comfortable', 'spacious'] as const;
export const FONTS = ['system', 'humanist', 'serif'] as const;
export const SIDEBARS = ['plain', 'tinted'] as const;
export const MOTIONS = ['system', 'reduced'] as const;

export type Accent = (typeof ACCENTS)[number];
export type Tone = (typeof TONES)[number];
export type Radius = (typeof RADII)[number];
export type Panels = (typeof PANELS)[number];
export type Density = (typeof DENSITIES)[number];
export type Font = (typeof FONTS)[number];
export type Sidebar = (typeof SIDEBARS)[number];
export type Motion = (typeof MOTIONS)[number];

export interface Appearance {
  accent: Accent;
  /** Hex colour used when accent is "custom". */
  customAccent: string;
  tone: Tone;
  radius: Radius;
  panels: Panels;
  density: Density;
  font: Font;
  sidebar: Sidebar;
  motion: Motion;
}

export const DEFAULT_APPEARANCE: Appearance = {
  accent: 'teal',
  customAccent: '#0f766e',
  tone: 'neutral',
  radius: 'medium',
  panels: 'subtle',
  density: 'comfortable',
  font: 'system',
  sidebar: 'plain',
  motion: 'system',
};

/** Swatch shown for each preset (its light-theme colour, as in appearance.css). */
export const ACCENT_SWATCH: Record<Exclude<Accent, 'custom'>, string> = {
  teal: '#0f766e',
  blue: '#1d4ed8',
  indigo: '#4338ca',
  violet: '#7c3aed',
  pink: '#be185d',
  graphite: '#374151',
};

/** Same key as the inline script in index.html, which applies it before the first paint. */
export const APPEARANCE_KEY = 'doccheck.appearance';

/** Attribute-backed choices; index.html reads this same list. */
const ATTRIBUTES = ['accent', 'tone', 'radius', 'panels', 'density', 'font', 'sidebar', 'motion'] as const;
const CHOICES: Record<(typeof ATTRIBUTES)[number], readonly string[]> = {
  accent: ACCENTS,
  tone: TONES,
  radius: RADII,
  panels: PANELS,
  density: DENSITIES,
  font: FONTS,
  sidebar: SIDEBARS,
  motion: MOTIONS,
};

const HEX = /^#[0-9a-f]{6}$/i;

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value);
}

/** Anything unknown or malformed falls back to its default, field by field. */
export function parseAppearance(raw: string | null): Appearance {
  let stored: Record<string, unknown> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === 'object') stored = parsed as Record<string, unknown>;
  } catch {
    // Corrupt value: defaults.
  }
  const result: Appearance = { ...DEFAULT_APPEARANCE };
  for (const key of ATTRIBUTES) {
    const value = stored[key];
    if (typeof value === 'string' && CHOICES[key].includes(value)) (result as unknown as Record<string, string>)[key] = value;
  }
  if (isHexColor(stored.customAccent)) result.customAccent = stored.customAccent.toLowerCase();
  return result;
}

type Rgb = [number, number, number];

function toRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(rgb: Rgb): string {
  return `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = toRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** White or near-black, whichever reads better on `hex`. */
export function readableOn(hex: string): string {
  const l = luminance(hex);
  return 1.05 / (l + 0.05) >= (l + 0.05) / 0.05 ? '#ffffff' : '#111416';
}

function mix(a: Rgb, b: Rgb, weightOfB: number): Rgb {
  const at = (x: number, y: number) => x + (y - x) * weightOfB;
  return [at(a[0], b[0]), at(a[1], b[1]), at(a[2], b[2])];
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Mixes `hex` towards `toward` in small steps until it reaches AA contrast (4.5:1) against `background`. */
function legibleOn(hex: string, background: string, toward: Rgb): string {
  const rgb = toRgb(hex);
  for (let weight = 0; weight <= 1; weight += 0.05) {
    const candidate = toHex(mix(rgb, toward, weight));
    if (contrast(candidate, background) >= 4.5) return candidate;
  }
  return toHex(toward);
}

/**
 * A picked colour as the four values the presets define: the colour for light backgrounds and for dark ones,
 * each nudged only as far as needed for links to stay legible (AA), and the text colour that sits on each.
 */
export function customAccentVars(hex: string): Record<string, string> {
  const light = legibleOn(hex.toLowerCase(), '#ffffff', [0, 0, 0]);
  const dark = legibleOn(hex.toLowerCase(), '#1a1e21', [255, 255, 255]);
  return { 'accent-l': light, 'accent-d': dark, 'on-accent-l': readableOn(light), 'on-accent-d': readableOn(dark) };
}

const CUSTOM_VARS = ['accent-l', 'accent-d', 'on-accent-l', 'on-accent-d'];

export function applyAppearance(appearance: Appearance): void {
  const root = document.documentElement;
  for (const key of ATTRIBUTES) {
    if (appearance[key] === DEFAULT_APPEARANCE[key]) delete root.dataset[key];
    else root.dataset[key] = appearance[key];
  }
  const vars = appearance.accent === 'custom' ? customAccentVars(appearance.customAccent) : {};
  for (const name of CUSTOM_VARS) {
    if (vars[name]) root.style.setProperty(`--${name}`, vars[name]);
    else root.style.removeProperty(`--${name}`);
  }
}

export function readAppearance(): Appearance {
  return parseAppearance(readPreference(APPEARANCE_KEY));
}

/** Stores the choices plus the derived custom colours, so index.html can paint them without this module. */
export function writeAppearance(appearance: Appearance): void {
  const vars = appearance.accent === 'custom' ? customAccentVars(appearance.customAccent) : undefined;
  writePreference(APPEARANCE_KEY, JSON.stringify({ ...appearance, vars }));
}
