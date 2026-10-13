import { BadRequestException, PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

/** Validates a request body with a Zod schema; the same schemas validate LLM output later. */
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({ message: 'Validation failed', issues: result.error.issues });
    }
    return result.data;
  }
}
