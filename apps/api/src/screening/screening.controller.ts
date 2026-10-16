import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import type { PublicUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CurrentOrg } from '../orgs/current-org.decorator';
import type { OrgContext } from '../orgs/org.types';
import { NoOrg, Permission } from '../orgs/permissions';
import { AddAllowlistDto, AllowlistQuery, RefreshDto, RemoveAllowlistDto, SearchQuery, ThresholdsDto } from './screening.dto';
import { ScreeningService } from './screening.service';

/**
 * Screening in the active organization: the lists in use and checking a name (data.read), and the
 * organization's allowlist (read: data.read; set aside or put back: finding.decide).
 */
@Controller('screening')
export class ScreeningController {
  constructor(private readonly screening: ScreeningService) {}

  @Get('lists')
  lists() {
    return this.screening.status();
  }

  /** ?q=name&country=CN&city=Urumqi: the closest list entries, scored as the rules score them. */
  @Get('search')
  search(@Query(new ZodValidationPipe(SearchQuery)) query: SearchQuery) {
    return this.screening.search(query);
  }

  /** ?history=true adds removed entries (the audit trail); ?all=true (server admins) every organization's. */
  @Get('allowlist')
  allowlist(@CurrentUser() user: PublicUser, @CurrentOrg() org: OrgContext, @Query(new ZodValidationPipe(AllowlistQuery)) query: AllowlistQuery) {
    return this.screening.allowlist(user, org, { history: query.history === 'true', all: query.all === 'true' });
  }

  /** Body { partyName, list, entryId, reason }: this party is not this list entry, for the organization. */
  @Post('allowlist')
  @Permission('finding.decide')
  add(@CurrentUser() user: PublicUser, @CurrentOrg() org: OrgContext, @Body(new ZodValidationPipe(AddAllowlistDto)) dto: AddAllowlistDto) {
    return this.screening.addAllowlist(user, org, dto);
  }

  /** Body { reason? }. The entry stays in the history. */
  @Delete('allowlist/:id')
  @Permission('finding.decide')
  remove(@CurrentUser() user: PublicUser, @CurrentOrg() org: OrgContext, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodValidationPipe(RemoveAllowlistDto)) dto: RemoveAllowlistDto) {
    return this.screening.removeAllowlist(user, org, id, dto.reason);
  }
}

/** Server admins only, outside any organization: the lists are global, and so are the thresholds. */
@Controller('admin/screening')
@NoOrg()
@UseGuards(AdminGuard)
export class ScreeningAdminController {
  constructor(private readonly screening: ScreeningService) {}

  @Get()
  status() {
    return this.screening.status();
  }

  /** Body { only?: string[] } (source ids). Starts the download in the background; answers with the status. */
  @Post('refresh')
  @HttpCode(202)
  refresh(@CurrentUser() user: PublicUser, @Body(new ZodValidationPipe(RefreshDto)) dto: RefreshDto) {
    return this.screening.refresh(user, dto.only);
  }

  /** Body { match, review } between 0.5 and 1, review not above match. */
  @Put('thresholds')
  setThresholds(@CurrentUser() user: PublicUser, @Body(new ZodValidationPipe(ThresholdsDto)) dto: ThresholdsDto) {
    return this.screening.setThresholds(dto, user);
  }

  @Delete('thresholds')
  resetThresholds() {
    return this.screening.resetThresholds();
  }
}
