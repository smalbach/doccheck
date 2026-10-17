import { CLOUD_OCR_ENGINES, LLM_PROVIDERS } from '@doccheck/extraction';
import { EMBED_PROVIDERS } from '@doccheck/regulations';
import { z } from 'zod';

/** No user:password@ part: URLs are shown and logged. */
const Url = z
  .string()
  .trim()
  .max(300)
  .regex(/^https?:\/\/[^\s/?#@]+(:\d+)?(\/[^\s?#@]*)?$/, 'Expected http(s)://host[:port][/path]')
  .transform((v) => v.replace(/\/$/, ''));
/** Empty keeps the saved key. */
const Secret = z.string().trim().max(4000).optional();
const Model = z.string().trim().regex(/^[\w.:/@-]{1,160}$/, 'Not a model name');

/**
 * Model services and their credentials as an admin enters them. A section set to null is removed
 * (with its saved key); a key left empty keeps the saved one.
 */
export const AiProvidersDto = z.object({
  localOnly: z.boolean(),
  llm: z.object({ provider: z.enum(LLM_PROVIDERS), model: Model.nullable().default(null) }),
  embeddings: z.object({ provider: z.enum(EMBED_PROVIDERS), model: Model.nullable().default(null), dimensions: z.number().int().min(64).max(8192).nullable().default(null) }),
  credentials: z.object({
    openai: z.object({ baseUrl: Url.default('https://api.openai.com/v1'), apiKey: Secret }).nullable().default(null),
    azureOpenai: z.object({ endpoint: Url, apiVersion: z.string().trim().regex(/^[\w.-]{1,40}$/).default('2024-10-21'), apiKey: Secret }).nullable().default(null),
    anthropic: z.object({ apiKey: Secret }).nullable().default(null),
    gemini: z.object({ apiKey: Secret }).nullable().default(null),
    googleVision: z.object({ apiKey: Secret }).nullable().default(null),
    awsTextract: z
      .object({ region: z.string().trim().regex(/^[a-z]{2}(-[a-z]+)+-\d$/, 'Expected an AWS region such as us-east-1'), accessKeyId: z.string().trim().regex(/^[A-Z0-9]{16,128}$/, 'Not an access key ID'), secretAccessKey: Secret })
      .nullable()
      .default(null),
    azureDi: z.object({ endpoint: Url, apiKey: Secret }).nullable().default(null),
  }),
});
export type AiProvidersDto = z.infer<typeof AiProvidersDto>;

export const AI_TEST_TARGETS = ['llm', 'embeddings', ...CLOUD_OCR_ENGINES] as const;

export const AiTestDto = z.object({
  target: z.enum(AI_TEST_TARGETS),
  /** Values not saved yet; saved keys fill in empty ones. Absent: test what is saved. */
  config: AiProvidersDto.optional(),
});
export type AiTestDto = z.infer<typeof AiTestDto>;

export const AiReindexDto = z.object({ scope: z.enum(['all', 'regulations', 'tariff']).default('all') });
export type AiReindexDto = z.infer<typeof AiReindexDto>;
