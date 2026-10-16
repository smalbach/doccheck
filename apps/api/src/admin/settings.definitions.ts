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

/** OCR engines: Tesseract in-process, or Baidu Unlimited-OCR served by scripts/ocr-server.py (Apple Silicon). */
export const OCR_ENGINES = ['tesseract', 'unlimited'] as const;
export type OcrEngine = (typeof OCR_ENGINES)[number];

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
  ocrEngine: define<OcrEngine>({
    env: 'OCR_ENGINE',
    defaultValue: 'tesseract',
    schema: z.enum(OCR_ENGINES),
    toEnv: (v) => v,
    fromEnv: (raw) => (raw === 'unlimited' ? 'unlimited' : 'tesseract'),
  }),
  ocrUrl: define<string>({
    env: 'OCR_URL',
    defaultValue: 'http://127.0.0.1:8765',
    // No user:password@ part: the URL is shown and logged.
    schema: z.string().max(200).regex(/^https?:\/\/[^\s/?#@]+(:\d+)?\/?$/, 'Expected http(s)://host:port'),
    toEnv: (v) => v.replace(/\/$/, ''),
    fromEnv: (raw) => raw,
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
  // Review queue: fields under this confidence wait for a person (packages/extraction/src/confidence.ts).
  reviewThreshold: define<number>({
    env: 'REVIEW_THRESHOLD',
    defaultValue: 0.85,
    schema: z.number().min(0.1).max(1),
    toEnv: (v) => String(v),
    fromEnv: (raw) => Number(raw),
  }),
  // A second reading of every document, compared field by field: twice the model time.
  reviewSecondPass: define<boolean>({
    env: 'REVIEW_SECOND_PASS',
    defaultValue: false,
    schema: z.boolean(),
    toEnv: (v) => String(v),
    fromEnv: (raw) => raw === 'true',
  }),
  // Supplier learning: corrected values become examples in the prompt for the same supplier's next documents.
  supplierLearning: define<boolean>({
    env: 'SUPPLIER_LEARNING',
    defaultValue: false,
    schema: z.boolean(),
    toEnv: (v) => String(v),
    fromEnv: (raw) => raw === 'true',
  }),
  supplierExamples: define<number>({
    env: 'SUPPLIER_EXAMPLES',
    defaultValue: 3,
    schema: z.number().int().min(1).max(10),
    toEnv: (v) => String(v),
    fromEnv: (raw) => Number(raw),
  }),
};

export type SettingKey = keyof typeof SETTINGS;
export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];

export function isSettingKey(key: string): key is SettingKey {
  return Object.hasOwn(SETTINGS, key);
}
