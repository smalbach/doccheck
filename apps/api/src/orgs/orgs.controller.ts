import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { AuthedRequest, PublicUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { Public } from '../auth/public.decorator';
import { SsoService } from '../auth/sso.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ShipmentOwnerGuard } from '../shipments/shipment-owner.guard';
import { CurrentOrg } from './current-org.decorator';
import type { OrgContext, OrgRequest } from './org.types';
import { AcceptInviteDto, CreateOrgDto, InviteDto, OrgSettingsDto, SetMemberRoleDto, ShareDto, SsoConfigDto } from './orgs.dto';
import { OrgsRepository } from './orgs.repository';
import { OrgsService } from './orgs.service';
import { NoOrg, Permission, permissionsOf } from './permissions';
import { RetentionJob } from './retention.job';

/**
 * Organizations (docs/ORGANIZATIONS.md). Routes under /orgs/current act in the organization the
 * session works in; POST /orgs/:id/switch changes it.
 */
@Controller('orgs')
export class OrgsController {
  constructor(
    private readonly orgs: OrgsService,
    private readonly repo: OrgsRepository,
    private readonly retention: RetentionJob,
    private readonly sso: SsoService,
  ) {}

  /** The user's organizations, `active` the one this session works in, each with the user's role and permissions. */
  @Get()
  @NoOrg()
  mine(@CurrentUser() user: PublicUser, @Req() req: OrgRequest) {
    return this.orgs.mine(user.id, req.org);
  }

  /** { name }: a new organization with the user as owner; the session switches to it. */
  @Post()
  @NoOrg()
  create(@CurrentUser() user: PublicUser, @Req() req: AuthedRequest, @Body(new ZodValidationPipe(CreateOrgDto)) dto: CreateOrgDto) {
    return this.orgs.create(user, dto.name, req.sessionTokenHash);
  }

  @Post(':id/switch')
  @NoOrg()
  @HttpCode(200)
  async switchTo(@CurrentUser() user: PublicUser, @Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    const org = await this.orgs.switchTo(user.id, id, req.sessionTokenHash);
    return { ...org, permissions: permissionsOf(org.role) };
  }

  /** What an invitation link offers, before signing in. */
  @Public()
  @Get('invites/:token')
  peekInvite(@Param('token') token: string) {
    return this.orgs.peekInvite(token);
  }

  /** { token }: joins the organization of an invitation sent to the user's email. */
  @Post('invites/accept')
  @NoOrg()
  @HttpCode(200)
  acceptInvite(@CurrentUser() user: PublicUser, @Req() req: AuthedRequest, @Body(new ZodValidationPipe(AcceptInviteDto)) dto: AcceptInviteDto) {
    return this.orgs.acceptInvite(user, dto.token, req.sessionTokenHash);
  }

  // The active organization ------------------------------------------------------------------------

  @Get('current')
  @Permission('shipment.read')
  async current(@CurrentOrg() org: OrgContext) {
    return { ...org, permissions: permissionsOf(org.role), settings: await this.repo.settings(org.id) };
  }

  /** { name?, retentionCaYears?, retentionUsYears?, retentionMxYears?, retentionEuYears?, retentionGbYears?, requireApproval?, slaEtaLeadHours? } */
  @Patch('current')
  @Permission('org.settings')
  updateSettings(@CurrentOrg() org: OrgContext, @Body(new ZodValidationPipe(OrgSettingsDto)) dto: OrgSettingsDto) {
    return this.orgs.updateSettings(org, dto);
  }

  /** Deletes the organization, its shipments and PDFs (owners; not a personal organization). */
  @Delete('current')
  @Permission('org.delete')
  @HttpCode(204)
  async remove(@CurrentOrg() org: OrgContext) {
    await this.orgs.deleteOrg(org);
  }

  /** Members, for every role but client (who sees no one), to assign and mention. */
  @Get('current/members')
  members(@CurrentOrg() org: OrgContext) {
    return this.repo.members(org.id);
  }

  @Patch('current/members/:userId')
  @Permission('members.manage')
  setRole(@CurrentOrg() org: OrgContext, @Param('userId', ParseUUIDPipe) userId: string, @Body(new ZodValidationPipe(SetMemberRoleDto)) dto: SetMemberRoleDto) {
    return this.orgs.setRole(org, userId, dto.role);
  }

  /** Removes a member (owners and admins), or leaves (anyone, their own id). */
  @Delete('current/members/:userId')
  @Permission('shipment.read')
  @HttpCode(204)
  async removeMember(@CurrentUser() user: PublicUser, @CurrentOrg() org: OrgContext, @Param('userId', ParseUUIDPipe) userId: string) {
    await this.orgs.remove(org, user, userId);
  }

  @Get('current/invites')
  @Permission('members.manage')
  invites(@CurrentOrg() org: OrgContext) {
    return this.repo.invites(org.id);
  }

  /** { email, role }: emails a link valid 7 days; a new one to the same address replaces the pending one. */
  @Post('current/invites')
  @Permission('members.manage')
  invite(@CurrentUser() user: PublicUser, @CurrentOrg() org: OrgContext, @Body(new ZodValidationPipe(InviteDto)) dto: InviteDto) {
    return this.orgs.invite(org, user, dto);
  }

  @Delete('current/invites/:id')
  @Permission('members.manage')
  @HttpCode(204)
  async revokeInvite(@CurrentOrg() org: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.orgs.revokeInvite(org, id);
  }

  /** How many shipments the retention period has expired now. */
  @Get('current/retention')
  @Permission('org.settings')
  retentionPreview(@CurrentOrg() org: OrgContext) {
    return this.retention.preview(org.id);
  }

  /** Deletes the expired shipments now instead of at the daily run; each deletion is audited. */
  @Post('current/retention/run')
  @Permission('org.settings')
  @HttpCode(200)
  runRetention(@CurrentUser() user: PublicUser, @CurrentOrg() org: OrgContext, @Req() req: AuthedRequest & { ip?: string }) {
    return this.retention.run(org.id, { userId: user.id, email: user.email, ip: req.ip ?? null });
  }

  @Get('current/sso')
  @Permission('org.settings')
  async ssoConfig(@CurrentOrg() org: OrgContext) {
    return (await this.sso.config(org.id)) ?? { enabled: false, redirectUri: SsoService.redirectUri() };
  }

  /** { enabled, issuer, clientId, clientSecret?, emailDomains, defaultRole }: checked against the issuer before saving. */
  @Put('current/sso')
  @Permission('org.settings')
  saveSso(@CurrentUser() user: PublicUser, @CurrentOrg() org: OrgContext, @Body(new ZodValidationPipe(SsoConfigDto)) dto: SsoConfigDto) {
    return this.sso.save(org.id, user.id, dto);
  }

  @Delete('current/sso')
  @Permission('org.settings')
  @HttpCode(204)
  async removeSso(@CurrentOrg() org: OrgContext) {
    await this.sso.remove(org.id);
  }
}

/** Sharing a shipment with clients: read-only access to that shipment alone. */
@Controller('shipments')
@UseGuards(ShipmentOwnerGuard)
@Permission('members.manage')
export class SharesController {
  constructor(
    private readonly orgs: OrgsService,
    private readonly repo: OrgsRepository,
  ) {}

  @Get(':id/shares')
  shares(@Param('id') id: string) {
    return this.repo.shares(id);
  }

  /** { userId } of a member whose role is client. */
  @Post(':id/shares')
  @HttpCode(200)
  share(@CurrentUser() user: PublicUser, @CurrentOrg() org: OrgContext, @Param('id') id: string, @Body(new ZodValidationPipe(ShareDto)) dto: ShareDto) {
    return this.orgs.share(org, user, id, dto.userId);
  }

  @Delete(':id/shares/:userId')
  unshare(@Param('id') id: string, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.orgs.unshare(id, userId);
  }
}
