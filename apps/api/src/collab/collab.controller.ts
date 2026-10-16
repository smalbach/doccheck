import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import type { PublicUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CurrentOrg } from '../orgs/current-org.decorator';
import type { OrgContext } from '../orgs/org.types';
import { NoOrg, Permission } from '../orgs/permissions';
import { ShipmentOwnerGuard } from '../shipments/shipment-owner.guard';
import {
  ApprovalDto, AssignDto, AssignFindingsDto, CommentsQuery, EditCommentDto, NewCommentDto, NotificationPrefsDto, ReadNotificationsDto, ScheduleDto,
} from './collab.dto';
import { CollabService } from './collab.service';
import { NotificationsService } from './notifications.service';

/** Teamwork on one shipment (ShipmentOwnerGuard: the active organization's, or shared with a client). */
@Controller('shipments')
@UseGuards(ShipmentOwnerGuard)
export class CollabController {
  constructor(private readonly collab: CollabService) {}

  /** Assignee, ETA and due date, findings' assignees, pending approvals and comment counts per target. */
  @Get(':id/collab')
  @Permission('shipment.read')
  summary(@Param('id') id: string, @CurrentOrg() org: OrgContext) {
    return this.collab.summary(id, org);
  }

  /** { userId | null } */
  @Put(':id/assignee')
  @Permission('assign')
  assign(@Param('id') id: string, @CurrentOrg() org: OrgContext, @CurrentUser() user: PublicUser, @Body(new ZodValidationPipe(AssignDto)) dto: AssignDto) {
    return this.collab.assignShipment(id, org, user, dto.userId);
  }

  /** { fingerprints, userId | null } for findings of the latest run. */
  @Put(':id/findings/assignee')
  @Permission('assign')
  assignFindings(@Param('id') id: string, @CurrentOrg() org: OrgContext, @CurrentUser() user: PublicUser, @Body(new ZodValidationPipe(AssignFindingsDto)) dto: AssignFindingsDto) {
    return this.collab.assignFindings(id, org, user, dto.fingerprints, dto.userId);
  }

  /** { eta?: "YYYY-MM-DD" | null, dueAt?: ISO date-time | null } */
  @Put(':id/schedule')
  @Permission('shipment.write')
  schedule(@Param('id') id: string, @CurrentOrg() org: OrgContext, @Body(new ZodValidationPipe(ScheduleDto)) dto: ScheduleDto) {
    return this.collab.schedule(id, org, dto);
  }

  /** ?targetKind=shipment|finding|document&targetId= ; oldest first. Not for clients. */
  @Get(':id/comments')
  @Permission('data.read')
  comments(@Param('id') id: string, @Query(new ZodValidationPipe(CommentsQuery)) q: CommentsQuery) {
    return this.collab.comments(id, q);
  }

  /** { targetKind, targetId, body, mentions: [userId] }: answers the target's comments. */
  @Post(':id/comments')
  @Permission('comment.write')
  addComment(@Param('id') id: string, @CurrentOrg() org: OrgContext, @CurrentUser() user: PublicUser, @Body(new ZodValidationPipe(NewCommentDto)) dto: NewCommentDto) {
    return this.collab.addComment(id, org, user, dto);
  }

  @Patch(':id/comments/:commentId')
  @Permission('comment.write')
  editComment(
    @Param('id') id: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: PublicUser,
    @Body(new ZodValidationPipe(EditCommentDto)) dto: EditCommentDto,
  ) {
    return this.collab.editComment(id, org, user, commentId, dto);
  }

  @Delete(':id/comments/:commentId')
  @Permission('comment.write')
  @HttpCode(204)
  async deleteComment(@Param('id') id: string, @Param('commentId', ParseUUIDPipe) commentId: string, @CurrentOrg() org: OrgContext, @CurrentUser() user: PublicUser) {
    await this.collab.deleteComment(id, org, user, commentId);
  }

  /** { decision: approved | rejected, note? }: on someone else's accepted risk or false positive. */
  @Post(':id/approvals/:requestId')
  @Permission('finding.approve')
  @HttpCode(200)
  decide(
    @Param('id') id: string,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: PublicUser,
    @Body(new ZodValidationPipe(ApprovalDto)) dto: ApprovalDto,
  ) {
    return this.collab.decide(id, org, user, requestId, dto);
  }
}

/** The approvals queue of the active organization. */
@Controller('approvals')
@Permission('finding.approve')
export class ApprovalsController {
  constructor(private readonly collab: CollabService) {}

  @Get()
  pending(@CurrentOrg() org: OrgContext) {
    return this.collab.pendingApprovals(org);
  }
}

/** The user's notifications, across their organizations, and what is emailed. */
@Controller('notifications')
@NoOrg()
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  /** ?unread=true; newest first, with the unread count. */
  @Get()
  list(@CurrentUser() user: PublicUser, @Query('unread') unread?: string) {
    return this.notifications.list(user.id, unread === 'true', 50);
  }

  /** { ids: [...] | "all" } */
  @Post('read')
  @HttpCode(204)
  async read(@CurrentUser() user: PublicUser, @Body(new ZodValidationPipe(ReadNotificationsDto)) dto: ReadNotificationsDto) {
    await this.notifications.markRead(user.id, dto.ids);
  }

  @Get('prefs')
  prefs(@CurrentUser() user: PublicUser) {
    return this.notifications.prefs(user.id);
  }

  /** { mention?: { inApp, email }, assignment?, approval_requested?, approval_decided? } */
  @Put('prefs')
  setPrefs(@CurrentUser() user: PublicUser, @Body(new ZodValidationPipe(NotificationPrefsDto)) dto: NotificationPrefsDto) {
    return this.notifications.setPrefs(user.id, dto);
  }
}
