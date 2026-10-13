import type { LlmProvider, StructuredRequest } from '@doccheck/extraction';
import type { z } from 'zod';

/**
 * The model behind the LLM client, replaceable while the API runs (an admin picks another model).
 * Calls in flight finish on the provider they started with; `id` (part of every cache key) follows
 * the current one, so a new model never reuses another model's cached answers.
 */
export class SwitchableProvider implements LlmProvider {
  constructor(private current: LlmProvider) {}

  get id(): string {
    return this.current.id;
  }

  replace(provider: LlmProvider): void {
    this.current = provider;
  }

  generate(req: StructuredRequest<z.ZodType>) {
    return this.current.generate(req);
  }

  version(): Promise<string | undefined> {
    return this.current.version?.() ?? Promise.resolve(undefined);
  }
}
