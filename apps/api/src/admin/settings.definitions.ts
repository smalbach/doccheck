import { createRequire } from 'node:module';
import { z } from 'zod';

/** OCR languages whose Tesseract data is installed (@tesseract.js-data/<code>); nothing is downloaded at run time. */
const requireFrom = createRequire(__filename);
export const OCR_LANGUAGES = ['eng', 'fra', 'spa', 'deu'].filter((code) => {
  try {
    requireFrom.resolve(`@tesseract.js-data/${code}/package.json`);
    return true;
  } catch {
    return false;
  }
});

/** Tesseract page segmentation modes worth offering: automatic, one column, one block (default), sparse text. */
export const OCR_PSM_VALUES = ['3', '4', '6', '11'] as const;

export interface SettingDefinition<T> {
  /** Environment variable the packages read; the effective value is written there. */
  env: string;
  defaultValue: T;
  schema: z.ZodType<T>;
  toEnv: (value: T) => string;
  fromEnv: (raw: string) => T;
}

const define = <T>(d: SettingDefinition<T>) => d;

/**
 * Settings an admin can change from the web. Order of precedence: a value saved by an admin, then
 * .env, then the default. The command-line evaluation keeps reading .env only.
 */
export const SETTINGS = {
  llmModel: define<string>({
    env: 'LLM_MODEL',
    defaultValue: 'qwen3.8',
    // Checked against the models Ollama reports before saving; it ends up in cache keys and URLs.
    schema: z.string().regex(/^[\w.:/-]{1,120}$/, 'Not a model name'),
    toEnv: (v) => v,
    fromEnv: (raw) => raw,
  }),
  agentEnabled: define<boolean>({
    env: 'AGENT_ENABLED',
    defaultValue: true,
    schema: z.boolean(),
    toEnv: (v) => String(v),
    fromEnv: (raw) => raw !== 'false',
  }),
  registrationOpen: define<boolean>({
    env: 'REGISTRATION_OPEN',
    defaultValue: true,
    schema: z.boolean(),
    toEnv: (v) => String(v),
    fromEnv: (raw) => raw !== 'false',
  }),
  ocrLanguages: define<string[]>({
    env: 'OCR_LANGS',
    defaultValue: ['eng', 'fra'],
    schema: z
      .array(z.string().refine((code) => OCR_LANGUAGES.includes(code), 'OCR language not installed'))
      .min(1)
      .refine((list) => new Set(list).size === list.length, 'Repeated language'),
    toEnv: (v) => v.join('+'),
    fromEnv: (raw) => raw.split('+').filter(Boolean),
  }),
  ocrScale: define<number>({
    env: 'OCR_SCALE',
    defaultValue: 4,
    schema: z.number().int().min(2).max(6),
    toEnv: (v) => String(v),
    fromEnv: (raw) => Number(raw),
  }),
  ocrPsm: define<string>({
    env: 'OCR_PSM',
    defaultValue: '6',
    schema: z.enum(OCR_PSM_VALUES),
    toEnv: (v) => v,
    fromEnv: (raw) => raw,
  }),
};

export type SettingKey = keyof typeof SETTINGS;
export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];

export function isSettingKey(key: string): key is SettingKey {
  return key in SETTINGS;
}
