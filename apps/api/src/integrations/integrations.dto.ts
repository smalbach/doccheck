import { EVENT_TYPES, TRACKING_PROVIDERS } from '@doccheck/integrations';
import { Destination } from '@doccheck/schemas';
import { z } from 'zod';

const Events = z.array(z.enum(EVENT_TYPES)).min(1).max(EVENT_TYPES.length);

export const CreateApiKeyDto = z
  .object({
    name: z.string().trim().min(1).max(100),
    scopes: z.array(z.enum(['read', 'write'])).min(1),
    rateLimit: z.number().int().min(1).max(10_000).optional(),
  })
  .strict();
export type CreateApiKeyDto = z.infer<typeof CreateApiKeyDto>;

export const CreateWebhookDto = z
  .object({ url: z.string().trim().max(2000), description: z.string().trim().max(200).optional(), events: Events })
  .strict();
export type CreateWebhookDto = z.infer<typeof CreateWebhookDto>;

export const UpdateWebhookDto = z
  .object({ url: z.string().trim().max(2000).optional(), description: z.string().trim().max(200).nullable().optional(), events: Events.optional(), active: z.boolean().optional() })
  .strict();
export type UpdateWebhookDto = z.infer<typeof UpdateWebhookDto>;

export const CreateChatAlertDto = z
  .object({ kind: z.enum(['slack', 'teams']), name: z.string().trim().min(1).max(100), url: z.string().trim().max(2000), events: Events, includeDetails: z.boolean().default(false) })
  .strict();
export type CreateChatAlertDto = z.infer<typeof CreateChatAlertDto>;

export const UpdateChatAlertDto = z
  .object({ name: z.string().trim().min(1).max(100).optional(), url: z.string().trim().max(2000).optional(), events: Events.optional(), includeDetails: z.boolean().optional(), active: z.boolean().optional() })
  .strict();
export type UpdateChatAlertDto = z.infer<typeof UpdateChatAlertDto>;

export const SourceDto = z
  .object({
    name: z.string().trim().min(1).max(100),
    kind: z.enum(['sftp', 'local', 's3']),
    config: z.record(z.string(), z.union([z.string().max(500), z.number()])),
    secret: z.string().max(20_000).optional(),
    groupBy: z.enum(['folder', 'filename']),
    pattern: z.string().max(200).nullable().optional(),
    destination: Destination.nullable().optional(),
    validate: z.boolean().default(true),
    pollSeconds: z.number().int().min(30).max(86_400).default(300),
    active: z.boolean().default(true),
  })
  .strict();
export type SourceDto = z.infer<typeof SourceDto>;
export const TestSourceDto = SourceDto.extend({ id: z.uuid().optional() });
export type TestSourceDto = z.infer<typeof TestSourceDto>;

export const TrackingDto = z
  .object({
    enabled: z.boolean(),
    provider: z.enum(TRACKING_PROVIDERS),
    endpoint: z.string().trim().max(2000).nullable().optional(),
    apiKey: z.string().max(2000).nullable().optional(),
    mockScenario: z.enum(['consistent', 'conflicting']).optional(),
  })
  .strict();
export type TrackingDto = z.infer<typeof TrackingDto>;
