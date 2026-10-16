import { Controller, Get, Query } from '@nestjs/common';
import { NoOrg } from '../orgs/permissions';
import { ALL_RULES, PROFILES } from '@doccheck/rules';
import { SCREENING_RULES } from '@doccheck/screening';
import { TARIFF_RULE_DEFINITIONS } from '@doccheck/tariff';
import type { Destination } from '@doccheck/schemas';

@NoOrg()
@Controller('rules')
export class RulesController {
  @Get()
  list(@Query('destination') destination?: Destination) {
    const active = destination && PROFILES[destination] ? new Set(PROFILES[destination].rules) : null;
    // Screening rules (S1-S3) run for every destination, after the document rules; then the tariff rules for the destination.
    const tariff = TARIFF_RULE_DEFINITIONS.filter((d) => !destination || d.appliesTo === 'ALL' || d.appliesTo.includes(destination));
    return [...ALL_RULES.map((r) => r.definition).filter((d) => !active || active.has(d.id)), ...SCREENING_RULES, ...tariff];
  }
}
