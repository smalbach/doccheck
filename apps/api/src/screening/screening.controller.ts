import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import type { PublicUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AddAllowlistDto, AllowlistQuery, RefreshDto, RemoveAllowlistDto, SearchQuery, ThresholdsDto } from './screening.dto';
import { ScreeningService } from './screening.service';

/** Screening for every signed-in user: the lists in use, checking a name, and the account's allowlist. */
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

  /** ?history=true adds removed entries (the audit trail); ?all=true (admins) every account's. */
  @Get('allowlist')
  allowlist(@CurrentUser() user: PublicUser, @Query(new ZodValidationPipe(AllowlistQuery)) query: AllowlistQuery) {
    return this.screening.allowlist(user, { history: query.history === 'true', all: query.all === 'true' });
  }

  /** Body { partyName, list, entryId, reason }: this party is not this list entry, for the user's account. */
  @Post('allowlist')
  add(@CurrentUser() user: PublicUser, @Body(new ZodValidationPipe(AddAllowlistDto)) dto: AddAllowlistDto) {
    return this.screening.addAllowlist(user, dto);
  }

  /** Body { reason? }. The entry stays in the history. */
  @Delete('allowlist/:id')
  remove(@CurrentUser() user: PublicUser, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodValidationPipe(RemoveAllowlistDto)) dto: RemoveAllowlistDto) {
    return this.screening.removeAllowlist(user, id, dto.reason);
  }
}

/** Admin only: refresh the lists and set the thresholds. */
@Controller('admin/screening')
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
