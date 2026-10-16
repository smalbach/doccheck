import { Controller, Get, Query } from '@nestjs/common';
import { ALL_RULES, PROFILES } from '@doccheck/rules';
import { SCREENING_RULES } from '@doccheck/screening';
import type { Destination } from '@doccheck/schemas';

@Controller('rules')
export class RulesController {
  @Get()
  list(@Query('destination') destination?: Destination) {
    const active = destination && PROFILES[destination] ? new Set(PROFILES[destination].rules) : null;
    // Screening rules (S1-S3) run for every destination, after the document rules.
    return [...ALL_RULES.map((r) => r.definition).filter((d) => !active || active.has(d.id)), ...SCREENING_RULES];
  }
}
